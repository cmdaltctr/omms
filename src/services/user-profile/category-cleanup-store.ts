import { join } from "node:path";
import { CONFIG } from "../../config.js";
import { tursoConnectionManager } from "../turso/connection-manager.js";
import type { TursoDb } from "../turso/turso-db.js";
import { USER_PROFILES_DB_NAME } from "./user-profile-manager.js";
import type { CategoryRename } from "./category-groups.js";

/**
 * Undo records for category cleanups (the profile changelog keeps too few entries for undo)
 * and the profile model's saved verdicts per group, so a new preview asks only about new groups.
 */
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
  await db.execute(`CREATE TABLE IF NOT EXISTS profile_category_verdicts (
    profile_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    keep TEXT NOT NULL,
    name TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, group_id)
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

/** What the profile model answered for one group: the labels it kept and the name it proposed. */
export interface SavedVerdict {
  keep: string[];
  name: string | null;
}

export const VERDICT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DELETE_CHUNK = 200;

/** Saves the answers by group id. Only category names are stored, never descriptions. */
export async function saveVerdicts(
  profileId: string,
  verdicts: Map<string, SavedVerdict>,
  now = Date.now()
): Promise<void> {
  const db = await connection();
  for (const [groupId, verdict] of verdicts) {
    await db.execute(
      "INSERT OR REPLACE INTO profile_category_verdicts (profile_id, group_id, keep, name, created_at) VALUES (?, ?, ?, ?, ?)",
      [profileId, groupId, JSON.stringify(verdict.keep), verdict.name, now]
    );
  }
}

export async function loadVerdicts(profileId: string): Promise<Map<string, SavedVerdict>> {
  const db = await connection();
  const rows = await db.all(
    "SELECT group_id, keep, name FROM profile_category_verdicts WHERE profile_id = ?",
    [profileId]
  );
  return new Map(
    rows.map((row) => [
      String(row.group_id),
      {
        keep: JSON.parse(String(row.keep)) as string[],
        name: row.name == null ? null : String(row.name),
      },
    ])
  );
}

/** Deletes the profile's answers that are too old or belong to a group that no longer exists. */
export async function pruneVerdicts(
  profileId: string,
  currentGroupIds: Iterable<string>,
  maxAgeMs = VERDICT_MAX_AGE_MS,
  now = Date.now()
): Promise<void> {
  const db = await connection();
  await db.execute(
    "DELETE FROM profile_category_verdicts WHERE profile_id = ? AND created_at < ?",
    [profileId, now - maxAgeMs]
  );
  const current = new Set(currentGroupIds);
  const rows = await db.all("SELECT group_id FROM profile_category_verdicts WHERE profile_id = ?", [
    profileId,
  ]);
  const gone = rows.map((row) => String(row.group_id)).filter((id) => !current.has(id));
  for (let start = 0; start < gone.length; start += DELETE_CHUNK) {
    const chunk = gone.slice(start, start + DELETE_CHUNK);
    await db.execute(
      `DELETE FROM profile_category_verdicts WHERE profile_id = ? AND group_id IN (${chunk.map(() => "?").join(",")})`,
      [profileId, ...chunk]
    );
  }
}
