import { constants, copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { INTERNAL_CAPTURE_SESSION_TITLES } from "../services/ai/internal-capture-sessions.js";
import { log } from "../services/logger.js";
import { withSqliteFileLockRetry } from "../services/turso/sqlite-handle-release.js";
import type { ImportSourceSession, ImportWindow } from "./importer.js";

interface SessionRow {
  id: string;
  directory: string;
  project_worktree: string | null;
  time_created: number;
}
interface MessageRow {
  id: string;
  time_created: number;
  data: string;
}
interface PartRow {
  message_id: string;
  data: string;
}

export interface OpencodeSourceSession extends ImportSourceSession {
  recordedDirectory: string;
  projectWorktree: string | null;
  timeCreated: number;
}
export interface OpencodeReader {
  childSessions: number;
  topLevelSessions: number;
  sessions: AsyncIterable<OpencodeSourceSession>;
}
export interface OpencodeReaderFilters {
  session?: string;
  maxSessions?: number;
  since?: number;
  until?: number;
}

function validateSchema(db: DatabaseSync): void {
  const required: Record<string, string[]> = {
    session: ["id", "directory", "project_id", "parent_id", "time_created"],
    project: ["id", "worktree"],
    message: ["id", "session_id", "time_created", "data"],
    part: ["id", "message_id", "session_id", "time_created", "data"],
  };
  for (const [table, columns] of Object.entries(required)) {
    const found = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (!found) throw new Error(`Unsupported OpenCode V1 database: missing ${table} table`);
    const names = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (column) => column.name
      )
    );
    for (const column of columns) {
      if (!names.has(column))
        throw new Error(`Unsupported OpenCode V1 database: missing ${table}.${column}`);
    }
  }
}

function parseData(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function boundInput(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > 100 ? `${text.slice(0, 100)}...` : text;
}

function buildWindows(
  db: DatabaseSync,
  sessionId: string,
  filters: OpencodeReaderFilters
): ImportWindow[] {
  const messages = db
    .prepare(
      "SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id"
    )
    .all(sessionId) as unknown as MessageRow[];
  const parts = db
    .prepare("SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created, id")
    .all(sessionId) as unknown as PartRow[];
  const byMessage = new Map<string, Record<string, unknown>[]>();
  for (const part of parts) {
    const entries = byMessage.get(part.message_id) ?? [];
    entries.push(parseData(part.data));
    byMessage.set(part.message_id, entries);
  }
  const units: ImportWindow[] = [];
  let current: ImportWindow | null = null;
  for (const message of messages) {
    const role = parseData(message.data).role;
    const content = byMessage.get(message.id) ?? [];
    if (role === "user") {
      if (current?.sourceEntryIds?.length) units.push(current);
      const prompt = content
        .filter(
          (part) =>
            part.type === "text" &&
            !part.synthetic &&
            !part.ignored &&
            typeof part.text === "string"
        )
        .map((part) => part.text)
        .join("\n")
        .trim();
      const timestamp = Number(message.time_created);
      current =
        prompt &&
        (filters.since === undefined || timestamp >= filters.since) &&
        (filters.until === undefined || timestamp <= filters.until)
          ? {
              userEntryId: message.id,
              userPrompt: prompt,
              userTimestamp: timestamp,
              sourceTimestamp: timestamp,
              textResponses: [],
              toolCalls: [],
              sourceEntryIds: [],
            }
          : null;
      continue;
    }
    if (role !== "assistant" || !current) continue;
    current.sourceEntryIds!.push(message.id);
    for (const part of content) {
      if (part.type === "text" && typeof part.text === "string" && !part.synthetic) {
        current.textResponses.push(part.text);
      } else if (part.type === "tool" || part.type === "agent" || part.type === "subtask") {
        const state =
          part.state && typeof part.state === "object"
            ? (part.state as Record<string, unknown>)
            : {};
        current.toolCalls.push({
          name: String(part.tool ?? part.name ?? part.type),
          input: boundInput(state.input ?? part.input ?? ""),
        });
      }
    }
  }
  if (current?.sourceEntryIds?.length) units.push(current);
  return units;
}

function fileStamp(path: string): string {
  const info = statSync(path, { bigint: true });
  return `${info.size}:${info.mtimeNs}`;
}

/**
 * Copy the database and its WAL into a private folder. `immutable=1` ignores
 * the WAL, and a normal open writes to OpenCode's `-shm`, so a copy is the only
 * way to see uncheckpointed turns while leaving every source file untouched.
 * A copy that raced a write or checkpoint is discarded and retried.
 */
/**
 * Remove a snapshot folder without ever failing the import. Windows can hold
 * SQLite files briefly after close, so retry lock errors; if the lock
 * outlasts the retries, log the leftover path instead of throwing.
 */
async function removeSnapshotDir(dir: string): Promise<void> {
  try {
    await withSqliteFileLockRetry(() => rmSync(dir, { recursive: true, force: true }));
  } catch (error) {
    log("OpenCode import: could not remove the temporary database copy", {
      dir,
      error: String(error),
    });
  }
}

function snapshotWalDatabase(dbPath: string): { path: string; cleanup: () => Promise<void> } {
  const dir = mkdtempSync(join(tmpdir(), "omms-opencode-"));
  const cleanup = () => removeSnapshotDir(dir);
  const copy = join(dir, "opencode.db");
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = [fileStamp(dbPath), fileStamp(`${dbPath}-wal`)];
      // Clone where the file system supports it (APFS, Btrfs): large databases copy instantly.
      copyFileSync(dbPath, copy, constants.COPYFILE_FICLONE);
      copyFileSync(`${dbPath}-wal`, `${copy}-wal`, constants.COPYFILE_FICLONE);
      const after = [fileStamp(dbPath), fileStamp(`${dbPath}-wal`)];
      if (before[0] === after[0] && before[1] === after[1]) return { path: copy, cleanup };
    }
  } catch (error) {
    void cleanup();
    throw error;
  }
  void cleanup();
  throw new Error("OpenCode database kept changing while it was copied; retry the import");
}

function openSnapshot(dbPath: string): { db: DatabaseSync; cleanup: () => Promise<void> } {
  if (!existsSync(`${dbPath}-wal`)) {
    // No WAL: every committed page is in the main file, so read it in place.
    const uri = `${pathToFileURL(dbPath).href}?immutable=1`;
    return { db: new DatabaseSync(uri, { readOnly: true }), cleanup: async () => {} };
  }
  const snapshot = snapshotWalDatabase(dbPath);
  try {
    return { db: new DatabaseSync(snapshot.path), cleanup: snapshot.cleanup };
  } catch (error) {
    void snapshot.cleanup();
    throw error;
  }
}

/** Read V1 OpenCode history without changing its database or WAL sidecars. */
export function readOpencodeHistory(
  dbPath: string,
  filters: OpencodeReaderFilters = {}
): OpencodeReader {
  if (!existsSync(dbPath)) throw new Error(`OpenCode database not found: ${dbPath}`);
  const { db, cleanup } = openSnapshot(dbPath);
  const close = async () => {
    db.close();
    await cleanup();
  };
  try {
    validateSchema(db);
    // omms's own capture/profile calls run in OpenCode sessions; never import them as history.
    const hasTitle = (db.prepare("PRAGMA table_info(session)").all() as { name: string }[]).some(
      (column) => column.name === "title"
    );
    const notInternal = hasTitle
      ? `AND (s.title IS NULL OR s.title NOT IN (${INTERNAL_CAPTURE_SESSION_TITLES.map(() => "?").join(", ")}))`
      : "";
    const internalArgs: string[] = hasTitle ? [...INTERNAL_CAPTURE_SESSION_TITLES] : [];
    const count = (where: string) =>
      Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS count FROM session s WHERE ${where} ${notInternal}`)
            .get(...internalArgs) as { count: number }
        ).count
      );
    const childSessions = count("s.parent_id IS NOT NULL");
    const topLevelSessions = count("s.parent_id IS NULL");
    const sessions: AsyncIterable<OpencodeSourceSession> = {
      async *[Symbol.asyncIterator]() {
        try {
          const query = `SELECT s.id, s.directory, p.worktree AS project_worktree, s.time_created
            FROM session s LEFT JOIN project p ON p.id = s.project_id
            WHERE s.parent_id IS NULL ${notInternal} ${filters.session ? "AND s.id = ?" : ""}
            ORDER BY s.time_created, s.id ${filters.maxSessions ? "LIMIT ?" : ""}`;
          const args: Array<string | number> = [...internalArgs];
          if (filters.session) args.push(filters.session);
          if (filters.maxSessions) args.push(filters.maxSessions);
          for (const row of db.prepare(query).all(...args) as unknown as SessionRow[]) {
            yield {
              sessionId: row.id,
              recordedDirectory: row.directory,
              directory: row.directory,
              sourceFile: dbPath,
              projectWorktree: row.project_worktree,
              timeCreated: row.time_created,
              units: buildWindows(db, row.id, filters),
            };
          }
        } finally {
          await close();
        }
      },
    };
    return { childSessions, topLevelSessions, sessions };
  } catch (error) {
    // Cleanup never throws, so the original error is what the caller sees.
    void close();
    throw error;
  }
}
