import type { UserProfile, UserProfileData } from "../../user-profile/types.js";
import type { ProfileDb } from "./connection.js";
import type { HistoryConfig } from "./history.js";
import { addChangelog, cleanupOldChangelogs } from "./history.js";
import { learnedPromptInserts } from "./learned-prompts.js";

// The callers clean the profile data (labels, workflow steps) before they pass it here.

export async function createProfileTables(db: ProfileDb): Promise<void> {
  await db.batch([
    {
      sql: `
        CREATE TABLE IF NOT EXISTS user_profiles (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          user_name TEXT NOT NULL,
          user_email TEXT NOT NULL,
          profile_data TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          last_analyzed_at INTEGER NOT NULL,
          total_prompts_analyzed INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT 1
        )
      `,
    },
    {
      sql: `
        CREATE TABLE IF NOT EXISTS user_profile_changelogs (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          change_type TEXT NOT NULL,
          change_summary TEXT NOT NULL,
          profile_data_snapshot TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
        )
      `,
    },
    {
      sql: `
        CREATE TABLE IF NOT EXISTS learned_prompts (
          profile_id TEXT NOT NULL,
          prompt_id TEXT NOT NULL,
          learned_at INTEGER NOT NULL,
          PRIMARY KEY (profile_id, prompt_id),
          FOREIGN KEY (profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
        )
      `,
    },
    { sql: "CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id)" },
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active ON user_profiles(is_active)",
    },
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_user_profile_changelogs_profile_id ON user_profile_changelogs(profile_id)",
    },
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_user_profile_changelogs_version ON user_profile_changelogs(version DESC)",
    },
  ]);
}

export async function getActiveProfile(db: ProfileDb, userId: string): Promise<UserProfile | null> {
  const row = await db.get(
    `
    SELECT * FROM user_profiles
    WHERE user_id = ? AND is_active = 1
    LIMIT 1
  `,
    [userId]
  );
  if (!row) return null;
  return rowToProfile(row);
}

export async function createProfile(
  db: ProfileDb,
  userId: string,
  displayName: string,
  userName: string,
  userEmail: string,
  cleanedData: UserProfileData,
  promptsAnalyzed: number,
  /** Prompt ids this save took in, recorded in the same write (see learned-prompts.ts). */
  learnedPromptIds: string[] = []
): Promise<string> {
  const id = `profile_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();

  await db.batch([
    {
      sql: `
    INSERT INTO user_profiles (
      id, user_id, display_name, user_name, user_email,
      profile_data, version, created_at, last_analyzed_at,
      total_prompts_analyzed, is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1)
  `,
      args: [
        id,
        userId,
        displayName,
        userName,
        userEmail,
        JSON.stringify(cleanedData),
        now,
        now,
        promptsAnalyzed,
      ],
    },
    ...learnedPromptInserts(id, learnedPromptIds, now),
  ]);

  await addChangelog(db, id, 1, "create", "Initial profile creation", cleanedData);

  return id;
}

export async function updateProfile(
  db: ProfileDb,
  profileId: string,
  cleanedData: UserProfileData,
  additionalPromptsAnalyzed: number,
  changeSummary: string,
  /** The version the caller read. The save is refused when the stored version differs. */
  expectedVersion: number,
  config: HistoryConfig,
  /** Prompt ids this save took in, recorded only when the save lands (see learned-prompts.ts). */
  learnedPromptIds: string[] = []
): Promise<boolean> {
  const now = Date.now();

  const versionRow = await db.get(`SELECT version FROM user_profiles WHERE id = ?`, [profileId]);
  const currentVersion = Number(versionRow?.version ?? 0);
  if (currentVersion !== expectedVersion) return false;
  const newVersion = currentVersion + 1;

  const saved = await db.transaction("write", async (tx) => {
    const result = await tx.execute({
      sql: `
    UPDATE user_profiles
    SET profile_data = ?,
        version = ?,
        last_analyzed_at = ?,
        total_prompts_analyzed = total_prompts_analyzed + ?
    WHERE id = ? AND version = ?
  `,
      args: [
        JSON.stringify(cleanedData),
        newVersion,
        now,
        additionalPromptsAnalyzed,
        profileId,
        currentVersion,
      ],
    });
    if (Number(result.rowsAffected ?? 0) === 0) return false;
    for (const insert of learnedPromptInserts(profileId, learnedPromptIds, now)) {
      await tx.execute(insert);
    }
    return true;
  });

  if (!saved) {
    return false;
  }

  await addChangelog(db, profileId, newVersion, "update", changeSummary, cleanedData);
  await cleanupOldChangelogs(db, profileId, config);

  return true;
}

export async function deleteProfile(db: ProfileDb, profileId: string): Promise<void> {
  await db.run(`DELETE FROM user_profiles WHERE id = ?`, [profileId]);
}

/** Turn a profile off without deleting it, so its data and changelog stay stored. */
export async function deactivateProfile(db: ProfileDb, profileId: string): Promise<boolean> {
  const changes = await db.run(`UPDATE user_profiles SET is_active = 0 WHERE id = ?`, [profileId]);
  return Number(changes) > 0;
}

export async function getProfileById(
  db: ProfileDb,
  profileId: string
): Promise<UserProfile | null> {
  const row = await db.get(`SELECT * FROM user_profiles WHERE id = ?`, [profileId]);
  if (!row) return null;
  return rowToProfile(row);
}

export async function getAllActiveProfiles(db: ProfileDb): Promise<UserProfile[]> {
  const rows = await db.all(`SELECT * FROM user_profiles WHERE is_active = 1`);
  return rows.map((row) => rowToProfile(row));
}

/**
 * The data columns of the newest active profile, or null when the file has no profile table or
 * no active profile. Reads no identity column and creates no table, so it suits a read-only
 * connection. From `spaces/export-space.ts`.
 */
export async function readNewestActiveProfileData(
  db: ProfileDb
): Promise<Record<string, unknown> | null> {
  const table = await db.get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_profiles'`
  );
  if (!table) return null;
  return db.get(
    `SELECT profile_data, version, last_analyzed_at, total_prompts_analyzed
       FROM user_profiles WHERE is_active = 1 ORDER BY last_analyzed_at DESC LIMIT 1`
  );
}

function rowToProfile(row: any): UserProfile {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    userName: row.user_name,
    userEmail: row.user_email,
    profileData: row.profile_data,
    version: row.version,
    createdAt: row.created_at,
    lastAnalyzedAt: row.last_analyzed_at,
    totalPromptsAnalyzed: row.total_prompts_analyzed,
    isActive: row.is_active === 1,
  };
}
