import type { ProfileDb } from "./connection.js";

// The learned-prompt record (TDR-091): the prompt ids a profile save took in, written in the
// same write as the save. A row lives from the save until user-prompts.db marks the prompt
// learned, so a batch whose mark failed is never sent to the model a second time. The table
// is created with the others in `createProfileTables`.

/** One insert per prompt id, for the transaction or batch that saves the profile. */
export function learnedPromptInserts(
  profileId: string,
  promptIds: string[],
  now: number
): Array<{ sql: string; args: Array<string | number> }> {
  return promptIds.map((promptId) => ({
    sql: `INSERT OR REPLACE INTO learned_prompts (profile_id, prompt_id, learned_at) VALUES (?, ?, ?)`,
    args: [profileId, promptId, now],
  }));
}

/** The ids in `promptIds` that a save already recorded for this profile. */
export async function getLearnedPromptIds(
  db: ProfileDb,
  profileId: string,
  promptIds: string[]
): Promise<string[]> {
  if (promptIds.length === 0) return [];
  const placeholders = promptIds.map(() => "?").join(",");
  const rows = await db.all(
    `SELECT prompt_id FROM learned_prompts WHERE profile_id = ? AND prompt_id IN (${placeholders})`,
    [profileId, ...promptIds]
  );
  const recorded = new Set(rows.map((row) => String(row.prompt_id)));
  return promptIds.filter((id) => recorded.has(id));
}

/** Removes the records of prompts that user-prompts.db now marks learned. */
export async function clearLearnedPromptIds(
  db: ProfileDb,
  profileId: string,
  promptIds: string[]
): Promise<void> {
  if (promptIds.length === 0) return;
  const placeholders = promptIds.map(() => "?").join(",");
  await db.run(
    `DELETE FROM learned_prompts WHERE profile_id = ? AND prompt_id IN (${placeholders})`,
    [profileId, ...promptIds]
  );
}
