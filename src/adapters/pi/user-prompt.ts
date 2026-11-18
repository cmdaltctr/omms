import type { PiSessionEntry } from "../../importer/pi-conversation.js";
import { isFullyPrivate, stripPrivateContent } from "../../services/privacy.js";
import { userPromptManager } from "../../services/user-prompt/user-prompt-manager.js";

/** The user prompt of a settled Pi turn: its session entry id and its text. */
export interface SettledPiPrompt {
  entryId: string;
  text: string;
}

/** The last user entry on the branch, or null when it has no text. */
export function lastSettledPiPrompt(entries: PiSessionEntry[]): SettledPiPrompt | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    const content = entry.message.content;
    if (typeof content === "string" && content.trim()) return { entryId: entry.id, text: content };
    if (Array.isArray(content)) {
      const text = content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (text) return { entryId: entry.id, text };
    }
    return null;
  }
  return null;
}

/**
 * Record a settled Pi prompt for profile learning (change unify-profile-learning, design D4).
 * The id is the Pi session id and the user entry id, as the Pi history import uses them, so
 * an import of the same session finds this row and saves no second copy. The prompt is marked
 * captured: Pi captures its own turns, and no other host's capture may take it.
 * Returns false when the prompt is empty or fully private and was not recorded.
 */
export async function recordPiPrompt(
  sessionId: string,
  userEntryId: string,
  directory: string,
  text: string
): Promise<boolean> {
  // Profile learning quotes saved prompts as evidence, so <private> text never reaches the store.
  if (isFullyPrivate(text)) return false;
  const prompt = stripPrivateContent(text).trim();
  if (!prompt) return false;
  const id = await userPromptManager.savePrompt(sessionId, userEntryId, directory, prompt);
  await userPromptManager.markAsCaptured(id);
  return true;
}
