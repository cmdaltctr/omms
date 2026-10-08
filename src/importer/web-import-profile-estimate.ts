import { existsSync } from "node:fs";
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
  const path = join(CONFIG.storagePath, "user-prompts.db");
  if (!existsSync(path)) return new Set();
  const { tursoConnectionManager } = await import("../services/turso/connection-manager.js");
  const db = await tursoConnectionManager.getConnection(path);
  if (
    !(await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_prompts'"))
  )
    return new Set();
  const rows = await db.all(
    "SELECT session_id, message_id, content FROM user_prompts WHERE user_learning_captured = 0"
  );
  return new Set(
    rows
      .filter((row) => {
        const text = stripPrivateContent(String(row.content)).trim();
        return text.length > 0 && !isTrivialPrompt(text);
      })
      .map((row) => profilePromptIdentity(String(row.session_id), String(row.message_id)))
  );
}
