import { join } from "node:path";
import { CONFIG } from "../config.js";
import { isTrivialPrompt } from "../core/trivial-prompt.js";
import { stripPrivateContent } from "../services/privacy.js";

export interface ProfileEstimate {
  /** Eligible history prompts absent from the shared waiting queue. */
  historyPrompts: number;
  waitingPrompts: number;
  totalPrompts: number;
  /** Analysis calls only; matching, deduplication and retries can add calls. */
  analysisCalls: number;
}

/** Use the prompt store's existing session/message identity without changing ledger keys. */
export function profilePromptIdentity(sessionId: string, messageId: string): string {
  return JSON.stringify([sessionId, messageId]);
}

/** Count the union of history and waiting prompts without counting overlapping identities twice. */
export function profileEstimate(
  history: Set<string>,
  waiting: Set<string>,
  batchSize: number
): ProfileEstimate {
  const historyPrompts = [...history].filter((key) => !waiting.has(key)).length;
  const totalPrompts = historyPrompts + waiting.size;
  return {
    historyPrompts,
    waitingPrompts: waiting.size,
    totalPrompts,
    analysisCalls: Math.ceil(totalPrompts / batchSize),
  };
}

/** Read waiting identities only. Never initialise the prompt store or mark trivial prompts learned. */
export async function readWaitingProfilePrompts(): Promise<Set<string>> {
  const { unanalysedPromptsAt } = await import("../services/storage/unanalysed-prompts.js");
  const rows = await unanalysedPromptsAt(join(CONFIG.storagePath, "user-prompts.db"));
  return new Set(
    rows
      .filter((row) => {
        const text = stripPrivateContent(row.content).trim();
        return text.length > 0 && !isTrivialPrompt(text);
      })
      .map((row) => profilePromptIdentity(row.sessionId, row.messageId))
  );
}
