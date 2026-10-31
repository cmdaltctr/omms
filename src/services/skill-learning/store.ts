import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tursoConnectionManager } from "../turso/connection-manager.js";
import type { TursoDb } from "../turso/turso-db.js";

/** Bump when the tables change, and add the step to `init`. */
export const SKILL_SCHEMA_VERSION = 1;
export const SKILLS_DB_FILE = "skills.db";

export type SkillToolOutcome = "ok" | "error" | "unknown";
export type SkillUseMethod = "tool" | "read" | "command";

export interface SkillToolCallRow {
  name: string;
  input: string;
  outcome: SkillToolOutcome;
  error: string | null;
}

export interface SkillUseRow {
  name: string;
  path: string | null;
  method: SkillUseMethod;
  /**
   * Index of the tool call that loaded the skill, or -1 for a slash command
   * (every tool call in the turn follows it). Missing or null: treated as -1.
   */
  position?: number | null;
}

/** One finished turn as it is written to `skills.db`. */
export interface SkillTurnRecord {
  /** `<host>:<session id>:<user message id>`. */
  turnKey: string;
  host: string;
  sessionId: string;
  projectTag: string | null;
  projectName: string | null;
  provider: string | null;
  model: string | null;
  createdAt: number;
  prompt: string;
  replies: string[];
  redacted: boolean;
  toolCalls: SkillToolCallRow[];
  skillUses: SkillUseRow[];
}

export class SkillStoreError extends Error {
  constructor(
    message: string,
    readonly code: "read_only"
  ) {
    super(message);
    this.name = "SkillStoreError";
  }
}

type GetConnection = (dbPath: string) => Promise<TursoDb>;

/** `skills.db` always sits in the global storage path, never in a project folder. */
export function skillsDbPath(storagePath: string): string {
  return join(storagePath, SKILLS_DB_FILE);
}

// Like chats.db, the file keeps the default rollback journal, so committed
// data lives in skills.db alone.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS skill_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_key TEXT NOT NULL UNIQUE,
    host TEXT NOT NULL,
    session_id TEXT NOT NULL,
    project_tag TEXT,
    project_name TEXT,
    provider TEXT,
    model TEXT,
    created_at INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    replies_json TEXT NOT NULL,
    redacted INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    input TEXT NOT NULL,
    outcome TEXT NOT NULL,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS skill_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
    skill_name TEXT NOT NULL,
    skill_path TEXT,
    method TEXT NOT NULL,
    position INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS skill_settings (
    skill_path TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    last_review_at INTEGER,
    uses_at_last_review INTEGER NOT NULL DEFAULT 0
  )`,
  // Evidence turn ids are a JSON list with no foreign key: deleting turns keeps proposals.
  `CREATE TABLE IF NOT EXISTS skill_proposals (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    skill_path TEXT,
    base_hash TEXT,
    proposed_content TEXT NOT NULL,
    diff TEXT,
    summary TEXT,
    evidence_turn_ids TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL,
    applied_by TEXT,
    drafted_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS skill_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id TEXT NOT NULL,
    path TEXT NOT NULL,
    previous_content TEXT,
    written_hash TEXT NOT NULL,
    saved_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS turns_created ON turns(created_at)`,
  `CREATE INDEX IF NOT EXISTS tool_calls_turn ON tool_calls(turn_id, position)`,
  `CREATE INDEX IF NOT EXISTS skill_uses_turn ON skill_uses(turn_id)`,
  `CREATE INDEX IF NOT EXISTS skill_uses_name ON skill_uses(skill_name)`,
  `CREATE INDEX IF NOT EXISTS skill_proposals_state ON skill_proposals(state, skill_name)`,
];

/** Adds a column to an existing table; a missing table or a present column is left as it is. */
async function addMissingColumn(db: TursoDb, table: string, column: string): Promise<void> {
  const exists = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [
    table,
  ]);
  if (!exists) return;
  try {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  } catch (error: any) {
    if (!String(error?.message ?? error).includes("duplicate column")) throw error;
  }
}

/**
 * Recorded turns, proposals and saved versions in `skills.db`. One instance
 * per file. Writes check the schema version, so a file from a newer OMMS
 * stays untouched. Reads on a missing file return empty values and do not
 * create the file.
 */
export class SkillStore {
  private readOnly = false;

  constructor(
    private readonly dbPath: string,
    private readonly connect: GetConnection = (path) => tursoConnectionManager.getConnection(path)
  ) {}

  /** The open connection. `proposal-store.ts` and `ranking.ts` share it. */
  db(): Promise<TursoDb> {
    return this.connect(this.dbPath);
  }

  /** Creates or upgrades the tables. Call it before any write. */
  async init(): Promise<void> {
    const db = await this.db();
    await db.execute(SCHEMA[0]!);
    const row = await db.get("SELECT value FROM skill_meta WHERE key = 'schema_version'");
    const version = row ? Number(row.value) : 0;
    if (version > SKILL_SCHEMA_VERSION) {
      this.readOnly = true;
      return;
    }
    this.readOnly = false;
    // A dev skills.db made before a column has the table without it. The
    // column must exist before the batch, which creates indexes on the table.
    await addMissingColumn(db, "skill_uses", "position INTEGER");
    await addMissingColumn(db, "skill_proposals", "drafted_by TEXT");
    await db.batch(SCHEMA.slice(1).map((sql) => ({ sql })));
    if (version < SKILL_SCHEMA_VERSION) {
      await db.run(
        "INSERT INTO skill_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [String(SKILL_SCHEMA_VERSION)]
      );
    }
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  private writable(): void {
    if (this.readOnly) {
      throw new SkillStoreError("skills.db is from a newer OMMS and is read-only", "read_only");
    }
  }

  /** Opens the file only when it and the `turns` table exist, so a read never creates it. */
  async existingDb(): Promise<TursoDb | null> {
    if (!existsSync(this.dbPath)) return null;
    const db = await this.db();
    const table = await db.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'turns'"
    );
    return table ? db : null;
  }

  /**
   * Writes the turn, its tool calls and its skill uses in one transaction.
   * Returns false when the `turn_key` is already stored; nothing is written then.
   */
  async insertTurn(turn: SkillTurnRecord): Promise<boolean> {
    this.writable();
    const db = await this.db();
    return db.transaction("write", async (tx) => {
      const inserted = await tx.execute({
        sql: `INSERT OR IGNORE INTO turns
          (turn_key, host, session_id, project_tag, project_name, provider, model, created_at, prompt, replies_json, redacted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          turn.turnKey,
          turn.host,
          turn.sessionId,
          turn.projectTag,
          turn.projectName,
          turn.provider,
          turn.model,
          turn.createdAt,
          turn.prompt,
          JSON.stringify(turn.replies),
          turn.redacted ? 1 : 0,
        ],
      });
      if (Number(inserted.rowsAffected) === 0) return false;
      const turnId = inserted.lastInsertRowid!;
      for (const [position, call] of turn.toolCalls.entries()) {
        await tx.execute({
          sql: "INSERT INTO tool_calls (turn_id, position, name, input, outcome, error) VALUES (?, ?, ?, ?, ?, ?)",
          args: [turnId, position, call.name, call.input, call.outcome, call.error],
        });
      }
      for (const use of turn.skillUses) {
        await tx.execute({
          sql: "INSERT INTO skill_uses (turn_id, skill_name, skill_path, method, position) VALUES (?, ?, ?, ?, ?)",
          args: [turnId, use.name, use.path, use.method, use.position ?? null],
        });
      }
      return true;
    });
  }

  /** Read-only lookup; a missing file gives false and stays missing. */
  async hasTurn(turnKey: string): Promise<boolean> {
    const db = await this.existingDb();
    if (!db) return false;
    return (await db.get("SELECT 1 AS found FROM turns WHERE turn_key = ?", [turnKey])) !== null;
  }

  async countTurns(): Promise<number> {
    const db = await this.existingDb();
    if (!db) return 0;
    const row = await db.get("SELECT COUNT(*) AS n FROM turns");
    return Number(row?.n ?? 0);
  }

  /** Deletes every turn with its tool calls and skill uses. Proposals and versions stay. */
  async deleteAllTurns(): Promise<number> {
    this.writable();
    const db = await this.existingDb();
    if (!db) return 0;
    const deleted = await db.transaction("write", async (tx) => {
      const result = await tx.execute("DELETE FROM turns");
      return Number(result.rowsAffected);
    });
    // A delete only marks pages free, so the turn text stays readable in the
    // file. VACUUM rewrites it. `secure_delete` would not hold: after each
    // transaction the libSQL client opens a fresh handle with default pragmas,
    // which is also why busy_timeout is set again here.
    await db.execute("PRAGMA busy_timeout = 5000");
    await db.execute("VACUUM");
    return deleted;
  }

  /** Size of `skills.db` in bytes, or 0 when the file does not exist. */
  fileSize(): number {
    try {
      return statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }
}
