import { isStructuredSummaryPromptMessage } from "../../core/internal-prompt.js";
import { isInternalStructuredSession } from "../../services/ai/opencode-provider.js";
import { userPromptManager } from "../../services/user-prompt/user-prompt-manager.js";

export { isStructuredSummaryPromptMessage };

/** True when a prompt is omms's own internal traffic and must not be recorded or searched. */
export function isInternalPrompt(sessionID: string, userMessage: string): boolean {
  return isStructuredSummaryPromptMessage(userMessage) || isInternalStructuredSession(sessionID);
}

/**
 * Record a real user prompt so idle auto-capture can pair it with the session's
 * response. Shared by the V1 `chat.message` hook and the v2 `prompt` hook.
 * Returns false when the prompt is empty or internal and was not recorded.
 */
export async function recordUserPrompt(
  sessionID: string,
  messageID: string,
  directory: string,
  userMessage: string
): Promise<boolean> {
  if (!userMessage.trim() || isInternalPrompt(sessionID, userMessage)) return false;
  await userPromptManager.savePrompt(sessionID, messageID, directory, userMessage);
  return true;
}
