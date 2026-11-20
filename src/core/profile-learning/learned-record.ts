import { log } from "../../services/logger.js";

// The learned-prompt record (TDR-091). A profile save records the prompt ids it took in, in the
// same write. A failed mark in user-prompts.db then cannot make a later pass, in this process
// or after a restart, send the same prompts to the model and save them a second time.

/** The prompt store call that marks prompts learned. */
export interface MarkPromptStore {
  markMultipleAsUserLearningCaptured(ids: string[]): Promise<void>;
}

/** The profile store calls of the learned-prompt record. */
export interface LearnedRecordStore {
  getLearnedPromptIds(ids: string[]): Promise<string[]>;
  forgetLearnedPromptIds(ids: string[]): Promise<void>;
}

const MARK_ATTEMPTS = 3;
const MARK_RETRY_MS = 100;

/**
 * Marks saved prompts learned, then drops their record in every profile. A storage error is
 * tried again. When every try fails, the record stays and the next run that takes these
 * prompts marks them without a model call. Never throws. The log holds a count only.
 */
export async function markSavedPromptsLearned(
  prompts: MarkPromptStore,
  profiles: LearnedRecordStore,
  ids: string[],
  logData: Record<string, unknown>
): Promise<void> {
  for (let attempt = 1; attempt <= MARK_ATTEMPTS; attempt++) {
    try {
      await prompts.markMultipleAsUserLearningCaptured(ids);
    } catch {
      if (attempt < MARK_ATTEMPTS) await new Promise((r) => setTimeout(r, MARK_RETRY_MS * attempt));
      continue;
    }
    try {
      await profiles.forgetLearnedPromptIds(ids);
    } catch {
      // A record left behind names prompts that are already learned, so it does no harm.
    }
    return;
  }
  log(
    "profile learning: prompts not marked as learned",
    { ...logData, prompts: ids.length },
    "error"
  );
}

/**
 * Removes from `batch` the prompts that an earlier save, into any profile, already took in,
 * and marks them learned. They never reach the model a second time. The prompt queue is shared
 * by every profile of the memory space, so the lookup is by prompt id alone.
 */
export async function withoutSavedPrompts<T extends { id: string }>(
  prompts: MarkPromptStore,
  profiles: LearnedRecordStore,
  batch: T[],
  logData: Record<string, unknown>
): Promise<T[]> {
  const saved = await profiles.getLearnedPromptIds(batch.map((prompt) => prompt.id));
  if (saved.length === 0) return batch;
  log("profile learning: prompts already saved", { ...logData, prompts: saved.length }, "warn");
  await markSavedPromptsLearned(prompts, profiles, saved, logData);
  const skip = new Set(saved);
  return batch.filter((prompt) => !skip.has(prompt.id));
}
