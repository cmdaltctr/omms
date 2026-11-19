import type { CONFIG } from "../../../config.js";
import type { UserProfileChangelog, UserProfileData } from "../../user-profile/types.js";
import type { ProfileDb } from "./connection.js";

/** The config value changelog retention reads. Callers pass CONFIG. */
export type HistoryConfig = Pick<typeof CONFIG, "userProfileChangelogRetentionCount">;

export async function addChangelog(
  db: ProfileDb,
  profileId: string,
  version: number,
  changeType: string,
  changeSummary: string,
  profileData: UserProfileData
): Promise<void> {
  const id = `changelog_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();

  await db.run(
    `
    INSERT INTO user_profile_changelogs (
      id, profile_id, version, change_type, change_summary,
      profile_data_snapshot, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    [id, profileId, version, changeType, changeSummary, JSON.stringify(profileData), now]
  );
}

export async function cleanupOldChangelogs(
  db: ProfileDb,
  profileId: string,
  config: HistoryConfig
): Promise<void> {
  const retentionCount = config.userProfileChangelogRetentionCount;

  await db.run(
    `
    DELETE FROM user_profile_changelogs
    WHERE profile_id = ?
    AND id NOT IN (
      SELECT id FROM user_profile_changelogs
      WHERE profile_id = ?
      ORDER BY version DESC
      LIMIT ?
    )
  `,
    [profileId, profileId, retentionCount]
  );
}

export async function getProfileChangelogs(
  db: ProfileDb,
  profileId: string,
  limit: number = 10
): Promise<UserProfileChangelog[]> {
  const rows = await db.all(
    `
    SELECT * FROM user_profile_changelogs
    WHERE profile_id = ?
    ORDER BY version DESC
    LIMIT ?
  `,
    [profileId, limit]
  );
  return rows.map((row) => rowToChangelog(row));
}

export async function getChangelogById(
  db: ProfileDb,
  id: string
): Promise<UserProfileChangelog | undefined> {
  const row = await db.get(`SELECT * FROM user_profile_changelogs WHERE id = ?`, [id]);
  if (!row) return undefined;
  return rowToChangelog(row);
}

function rowToChangelog(row: any): UserProfileChangelog {
  return {
    id: row.id,
    profileId: row.profile_id,
    version: row.version,
    changeType: row.change_type,
    changeSummary: row.change_summary,
    profileDataSnapshot: row.profile_data_snapshot,
    createdAt: row.created_at,
  };
}
