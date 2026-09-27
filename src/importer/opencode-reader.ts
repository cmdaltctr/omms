import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { INTERNAL_CAPTURE_SESSION_TITLES } from "../services/ai/internal-capture-sessions.js";
import type { ImportWindow } from "./importer.js";
import {
  acquirePrivateSnapshot,
  opencodeSnapshots,
  OpencodeSnapshotError,
  type SnapshotLease,
} from "./opencode-snapshot.js";

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

export const DEFAULT_OPENCODE_DB = join(homedir(), ".local/share/opencode/opencode.db");

/** One top-level session's metadata; its turns are built on demand. */
export interface OpencodeSessionMeta {
  sessionId: string;
  recordedDirectory: string;
  projectWorktree: string | null;
  timeCreated: number;
}
export interface OpencodeHistory {
  childSessions: number;
  topLevelSessions: number;
  /** Top-level sessions matching the filters, oldest first. */
  sessions: OpencodeSessionMeta[];
  /** Build one session's work units; call only before `close`. */
  loadUnits: (sessionId: string) => ImportWindow[];
  close: () => Promise<void>;
}
export interface OpencodeReaderFilters {
  session?: string;
  /** Web selection; never combined with `session` or `maxSessions`. */
  sessionIds?: string[];
  maxSessions?: number;
  since?: number;
  until?: number;
}
export interface OpencodeOpenOptions {
  /**
   * Share the snapshot with the web listing and jobs under this source key.
   * `fresh` copies again, `reuse` fails when no copy exists, `any` does either.
   */
  shared?: { key: string; mode: "fresh" | "reuse" | "any" };
  signal?: AbortSignal;
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

type OpenedSource = { db: DatabaseSync; lease?: SnapshotLease; stamp?: string };

async function openSnapshot(dbPath: string, options: OpencodeOpenOptions): Promise<OpenedSource> {
  const lease = options.shared
    ? await opencodeSnapshots.acquire(
        options.shared.key,
        dbPath,
        options.shared.mode,
        options.signal
      )
    : await acquirePrivateSnapshot(dbPath, options.signal);
  try {
    return { db: new DatabaseSync(lease.path), lease };
  } catch (error) {
    await lease.release();
    throw error;
  }
}

/**
 * Without a WAL every committed page is in the main file, so read it in place
 * with `immutable=1`. A rollback journal means a writer is mid-transaction,
 * which an immutable read could see half-done.
 */
async function openSource(dbPath: string, options: OpencodeOpenOptions): Promise<OpenedSource> {
  if (existsSync(`${dbPath}-wal`)) return openSnapshot(dbPath, options);
  if (existsSync(`${dbPath}-journal`)) {
    throw new OpencodeSnapshotError(
      "busy",
      "The OpenCode database is being written. Retry in a moment, or choose a backup."
    );
  }
  const stamp = fileStamp(dbPath);
  const uri = `${pathToFileURL(dbPath).href}?immutable=1`;
  return { db: new DatabaseSync(uri, { readOnly: true }), stamp };
}

/** True when an in-place read may have raced a writer that started meanwhile. */
function changedSinceOpen(dbPath: string, source: OpenedSource): boolean {
  if (source.stamp === undefined) return false;
  return existsSync(`${dbPath}-wal`) || fileStamp(dbPath) !== source.stamp;
}

function readSessions(
  db: DatabaseSync,
  filters: OpencodeReaderFilters
): Omit<OpencodeHistory, "loadUnits" | "close"> {
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
  const query = `SELECT s.id, s.directory, p.worktree AS project_worktree, s.time_created
    FROM session s LEFT JOIN project p ON p.id = s.project_id
    WHERE s.parent_id IS NULL ${notInternal} ${filters.session ? "AND s.id = ?" : ""}
    ${filters.sessionIds ? "AND s.id IN (SELECT value FROM json_each(?))" : ""}
    ORDER BY s.time_created, s.id ${filters.maxSessions ? "LIMIT ?" : ""}`;
  const args: Array<string | number> = [...internalArgs];
  if (filters.session) args.push(filters.session);
  if (filters.sessionIds) args.push(JSON.stringify(filters.sessionIds));
  if (filters.maxSessions) args.push(filters.maxSessions);
  const sessions = (db.prepare(query).all(...args) as unknown as SessionRow[]).map((row) => ({
    sessionId: row.id,
    recordedDirectory: row.directory,
    projectWorktree: row.project_worktree,
    timeCreated: Number(row.time_created),
  }));
  return {
    childSessions: count("s.parent_id IS NOT NULL"),
    topLevelSessions: count("s.parent_id IS NULL"),
    sessions,
  };
}

/** Read V1 OpenCode history without changing its database or WAL sidecars. */
export async function openOpencodeHistory(
  dbPath: string,
  filters: OpencodeReaderFilters = {},
  options: OpencodeOpenOptions = {}
): Promise<OpencodeHistory> {
  if (!existsSync(dbPath)) throw new Error("OpenCode database not found");
  let source = await openSource(dbPath, options);
  let listed: Omit<OpencodeHistory, "loadUnits" | "close">;
  try {
    listed = readSessions(source.db, filters);
    if (changedSinceOpen(dbPath, source)) {
      // OpenCode started writing during the in-place read: read a private copy instead.
      source.db.close();
      source = await openSnapshot(dbPath, options);
      listed = readSessions(source.db, filters);
    }
  } catch (error) {
    // Cleanup never throws, so the original error is what the caller sees.
    source.db.close();
    await source.lease?.release();
    throw error;
  }
  const opened = source;
  let closed = false;
  return {
    ...listed,
    loadUnits: (sessionId) => buildWindows(opened.db, sessionId, filters),
    close: async () => {
      if (closed) return;
      closed = true;
      opened.db.close();
      await opened.lease?.release();
    },
  };
}
