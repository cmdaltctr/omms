import { join } from "node:path";
import { tursoConnectionManager } from "./turso/connection-manager.js";

/**
 * The last Claude Code user entry that live capture handled, per session. It
 * lives in `user-prompts.db` next to the capture retry queue, so a web app
 * restart does not capture the last turn again. Callers pass `CONFIG`.
 */
export interface ClaudeCaptureCursorConfig {
  storagePath: string;
}

/** A session with no capture for this long loses its cursor. */
const CURSOR_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const prepared = new Map<string, Promise<void>>();

async function database(config: ClaudeCaptureCursorConfig) {
  const path = join(config.storagePath, "user-prompts.db");
  const db = await tursoConnectionManager.getConnection(path);
  let ready = prepared.get(path);
  if (!ready) {
    ready = db
      .batch([
        {
          sql: `CREATE TABLE IF NOT EXISTS claude_capture_cursors (
          session_id TEXT PRIMARY KEY,
          last_user_entry_id TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        },
        {
          sql: "DELETE FROM claude_capture_cursors WHERE updated_at < ?",
          args: [Date.now() - CURSOR_RETENTION_MS],
        },
      ])
      .then(() => undefined);
    // A failed preparation is tried again on the next call.
    ready.catch(() => prepared.delete(path));
    prepared.set(path, ready);
  }
  await ready;
  return db;
}

export async function readClaudeCaptureCursor(
  sessionId: string,
  config: ClaudeCaptureCursorConfig
): Promise<string | null> {
  const db = await database(config);
  const row = await db.get<{ last_user_entry_id: string }>(
    "SELECT last_user_entry_id FROM claude_capture_cursors WHERE session_id = ?",
    [sessionId]
  );
  return row ? String(row.last_user_entry_id) : null;
}

export async function writeClaudeCaptureCursor(
  sessionId: string,
  userEntryId: string,
  config: ClaudeCaptureCursorConfig,
  now = Date.now()
): Promise<void> {
  const db = await database(config);
  await db.run(
    `INSERT INTO claude_capture_cursors (session_id, last_user_entry_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       last_user_entry_id = excluded.last_user_entry_id, updated_at = excluded.updated_at`,
    [sessionId, userEntryId, now]
  );
}
