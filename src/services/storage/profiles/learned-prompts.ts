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

/**
 * The ids in `promptIds` that a save already recorded, for any profile. The prompt queue is
 * shared by every profile of the memory space, so a prompt saved into one profile must not
 * reach the model again through another.
 */
export async function getLearnedPromptIds(db: ProfileDb, promptIds: string[]): Promise<string[]> {
  if (promptIds.length === 0) return [];
  const placeholders = promptIds.map(() => "?").join(",");
  const rows = await db.all(
    `SELECT prompt_id FROM learned_prompts WHERE prompt_id IN (${placeholders})`,
    promptIds
  );
  const recorded = new Set(rows.map((row) => String(row.prompt_id)));
  return promptIds.filter((id) => recorded.has(id));
}

/**
 * Removes every profile's record of these prompts. A successful mark calls it, and so does a
 * forced re-analysis before it puts the prompts back in the learning queue, so no pass skips
 * them as already saved.
 */
export async function forgetLearnedPromptIds(db: ProfileDb, promptIds: string[]): Promise<void> {
  if (promptIds.length === 0) return;
  const placeholders = promptIds.map(() => "?").join(",");
  await db.run(`DELETE FROM learned_prompts WHERE prompt_id IN (${placeholders})`, promptIds);
}
