import { join } from "node:path";
import { CONFIG } from "../../config.js";
import { tursoConnectionManager } from "../turso/connection-manager.js";
import type { TursoDb } from "../turso/turso-db.js";
import { USER_PROFILES_DB_NAME } from "./user-profile-manager.js";
import type { RestoreEntry } from "./ai-cleanup-apply.js";

/** A record can be undone for this long, then it is deleted. */
export const AUTO_CLEANUP_RECORD_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AutoCleanupRecordInput {
  promptsAnalyzed: number;
  merged: number;
  removed: number;
  entries: RestoreEntry[];
}

export interface AutoCleanupSummary {
  id: number;
  createdAt: number;
  merged: number;
  removed: number;
}

export interface AutoCleanupRecord extends AutoCleanupSummary {
  promptsAnalyzed: number;
  entries: RestoreEntry[];
}

/**
 * Restore records of automatic cleanups: the items a run merged or removed, as stored, and
 * the merged item it wrote. The text is profile text and stays in the profile database. It
 * is never logged.
 */
async function connection(): Promise<TursoDb> {
  const db = await tursoConnectionManager.getConnection(
    join(CONFIG.storagePath || "", USER_PROFILES_DB_NAME)
  );
  await db.execute(`CREATE TABLE IF NOT EXISTS profile_auto_cleanups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    prompts_analyzed INTEGER NOT NULL,
    merged INTEGER NOT NULL,
    removed INTEGER NOT NULL,
    entries TEXT NOT NULL,
    undone_at INTEGER
  )`);
  return db;
}

async function prune(db: TursoDb, now: number): Promise<void> {
  await db.execute("DELETE FROM profile_auto_cleanups WHERE created_at < ?", [
    now - AUTO_CLEANUP_RECORD_MAX_AGE_MS,
  ]);
}

export async function insertAutoCleanupRecord(
  profileId: string,
  record: AutoCleanupRecordInput,
  now = Date.now()
): Promise<number> {
  const db = await connection();
  await prune(db, now);
  // The id comes from this INSERT. A separate SELECT could return the row of another host
  // that wrote for the same profile in between, and a failed save would delete that row.
  const result = await db.execute(
    "INSERT INTO profile_auto_cleanups (profile_id, created_at, prompts_analyzed, merged, removed, entries) VALUES (?, ?, ?, ?, ?, ?)",
    [
      profileId,
      now,
      record.promptsAnalyzed,
      record.merged,
      record.removed,
      JSON.stringify(record.entries),
    ]
  );
  if (result.lastInsertRowid === undefined) throw new Error("Restore record id missing");
  return Number(result.lastInsertRowid);
}

/**
 * Deletes every record older than 30 days, for all profiles. The daily cleanup and the web
 * app start call it, so a record does not outlive its limit when nothing else touches the
 * table. Returns how many rows it deleted.
 */
export async function pruneAutoCleanupRecords(now = Date.now()): Promise<number> {
  const db = await connection();
  const result = await db.execute("DELETE FROM profile_auto_cleanups WHERE created_at < ?", [
    now - AUTO_CLEANUP_RECORD_MAX_AGE_MS,
  ]);
  return Number(result.rowsAffected ?? 0);
}

export async function deleteAutoCleanup(id: number): Promise<void> {
  const db = await connection();
  await db.execute("DELETE FROM profile_auto_cleanups WHERE id = ?", [id]);
}

/** The newest record of the profile that is not undone, without its items. */
export async function latestOpenAutoCleanupSummary(
  profileId: string,
  now = Date.now()
): Promise<AutoCleanupSummary | null> {
  const db = await connection();
  await prune(db, now);
  const row = await db.get(
    "SELECT id, created_at, merged, removed FROM profile_auto_cleanups WHERE profile_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1",
    [profileId]
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    createdAt: Number(row.created_at),
    merged: Number(row.merged),
    removed: Number(row.removed),
  };
}

/** The newest record of the profile that is not undone, with the items to restore. */
export async function latestOpenAutoCleanup(
  profileId: string,
  now = Date.now()
): Promise<AutoCleanupRecord | null> {
  const db = await connection();
  await prune(db, now);
  const row = await db.get(
    "SELECT id, created_at, prompts_analyzed, merged, removed, entries FROM profile_auto_cleanups WHERE profile_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1",
    [profileId]
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    createdAt: Number(row.created_at),
    promptsAnalyzed: Number(row.prompts_analyzed),
    merged: Number(row.merged),
    removed: Number(row.removed),
    entries: JSON.parse(String(row.entries)) as RestoreEntry[],
  };
}

export async function markAutoCleanupUndone(id: number, now = Date.now()): Promise<void> {
  const db = await connection();
  await db.execute("UPDATE profile_auto_cleanups SET undone_at = ? WHERE id = ?", [now, id]);
}
