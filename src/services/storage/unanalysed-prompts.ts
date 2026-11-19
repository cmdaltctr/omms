import { existsSync } from "node:fs";
import { tursoConnectionManager } from "../turso/connection-manager.js";

/** A prompt still waiting for profile learning, as the import estimate reads it. */
export interface UnanalysedPrompt {
  sessionId: string;
  messageId: string;
  content: string;
}

/**
 * The prompts in the `user-prompts.db` at `path` that profile learning has not analysed.
 * Read only: a missing file or table gives an empty list, and nothing is created or upgraded.
 */
export async function unanalysedPromptsAt(path: string): Promise<UnanalysedPrompt[]> {
  if (!existsSync(path)) return [];
  const db = await tursoConnectionManager.getConnection(path);
  if (
    !(await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_prompts'"))
  )
    return [];
  const rows = await db.all(
    "SELECT session_id, message_id, content FROM user_prompts WHERE user_learning_captured = 0"
  );
  return rows.map((row) => ({
    sessionId: String(row.session_id),
    messageId: String(row.message_id),
    content: String(row.content),
  }));
}
