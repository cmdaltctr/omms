import { isInternalStructuredSession } from "../../services/ai/opencode-provider.js";
import { userPromptManager } from "../../services/user-prompt/user-prompt-manager.js";

export function isStructuredSummaryPromptMessage(userMessage: string): boolean {
  // This is the plugin's own structured-summary or profile-analysis request.
  // OpenCode echoes it through chat.message like a normal user message, but
  // capturing it would create self-referential memories / an infinite learning loop.
  if (userMessage.includes("# User Profile Analysis")) {
    return true;
  }
  return userMessage.includes("Analyze this conversation.") && userMessage.includes('type="skip"');
}

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
