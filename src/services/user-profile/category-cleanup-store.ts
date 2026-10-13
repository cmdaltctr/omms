import { join } from "node:path";
import { CONFIG } from "../../config.js";
import { tursoConnectionManager } from "../turso/connection-manager.js";
import type { TursoDb } from "../turso/turso-db.js";
import { USER_PROFILES_DB_NAME } from "./user-profile-manager.js";
import type { CategoryRename } from "./category-groups.js";

/** Undo records for category cleanups. The profile changelog keeps too few entries for undo. */
async function connection(): Promise<TursoDb> {
  const db = await tursoConnectionManager.getConnection(
    join(CONFIG.storagePath || "", USER_PROFILES_DB_NAME)
  );
  await db.execute(`CREATE TABLE IF NOT EXISTS profile_category_cleanups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    renames TEXT NOT NULL,
    undone_at INTEGER
  )`);
  return db;
}

export async function recordCleanup(profileId: string, renames: CategoryRename[]): Promise<void> {
  const db = await connection();
  await db.execute(
    "INSERT INTO profile_category_cleanups (profile_id, created_at, renames) VALUES (?, ?, ?)",
    [profileId, Date.now(), JSON.stringify(renames)]
  );
}

/** The newest cleanup of a profile that has not been undone. */
export async function latestOpenCleanup(
  profileId: string
): Promise<{ id: number; renames: CategoryRename[] } | null> {
  const db = await connection();
  const row = await db.get(
    "SELECT id, renames FROM profile_category_cleanups WHERE profile_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1",
    [profileId]
  );
  if (!row) return null;
  return { id: Number(row.id), renames: JSON.parse(String(row.renames)) };
}

export async function markCleanupUndone(id: number): Promise<void> {
  const db = await connection();
  await db.execute("UPDATE profile_category_cleanups SET undone_at = ? WHERE id = ?", [
    Date.now(),
    id,
  ]);
}
