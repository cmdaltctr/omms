import { join } from "node:path";
import { getStoragePath } from "../active-space-access.js";
import { tursoConnectionManager } from "../../turso/connection-manager.js";
import type { TursoDb } from "../../turso/turso-db.js";
import { USER_PROFILES_DB_NAME } from "./connection.js";

/**
 * The memories that AI Cleanup looked at and kept, one row per memory of a profile. A row
 * holds a hash of the memory (see `ai-cleanup-checked.ts`) and the time of the mark, never
 * memory text. The table lives in the active space's `user-profiles.db`, and each call
 * opens it from the live storage path, so a memory space switch needs no reset.
 */
async function connection(): Promise<TursoDb> {
  const db = await tursoConnectionManager.getConnection(
    join(getStoragePath() || "", USER_PROFILES_DB_NAME)
  );
  await db.execute(`CREATE TABLE IF NOT EXISTS profile_ai_checked (
    profile_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    checked_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, item_key)
  )`);
  return db;
}

/** Marks each key as checked now. One statement per key in one batch, so no bind limit applies. */
export async function markAiChecked(
  profileId: string,
  keys: string[],
  now = Date.now()
): Promise<void> {
  if (keys.length === 0) return;
  const db = await connection();
  await db.batch(
    [...new Set(keys)].map((key) => ({
      sql: "INSERT OR REPLACE INTO profile_ai_checked (profile_id, item_key, checked_at) VALUES (?, ?, ?)",
      args: [profileId, key, now],
    }))
  );
}

export async function readAiCheckedKeys(profileId: string): Promise<Set<string>> {
  const db = await connection();
  const rows = await db.all("SELECT item_key FROM profile_ai_checked WHERE profile_id = ?", [
    profileId,
  ]);
  return new Set(rows.map((row) => String(row.item_key)));
}

export async function deleteAiCheckedKeys(profileId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await connection();
  await db.batch(
    [...new Set(keys)].map((key) => ({
      sql: "DELETE FROM profile_ai_checked WHERE profile_id = ? AND item_key = ?",
      args: [profileId, key],
    }))
  );
}

/** Deletes every mark of the profile whose key is not in `liveKeys`. Returns how many. */
export async function pruneAiCheckedTo(
  profileId: string,
  liveKeys: Iterable<string>
): Promise<number> {
  const live = new Set(liveKeys);
  const stale = [...(await readAiCheckedKeys(profileId))].filter((key) => !live.has(key));
  await deleteAiCheckedKeys(profileId, stale);
  return stale.length;
}
