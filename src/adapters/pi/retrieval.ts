import { CONFIG } from "../../config.js";
import { formatContextForPrompt } from "../../services/context.js";
import { memoryClient } from "../../services/client.js";
import { getTags } from "../../services/tags.js";

/**
 * Prompt-aware semantic retrieval for Pi's `before_agent_start`: search the
 * shared project memory with the incoming prompt and format a bounded context
 * section (memory + user profile) using the same formatter as OpenCode chat
 * injection. Returns null when nothing relevant is found.
 */
export async function buildPiRetrievalSection(
  prompt: string,
  directory: string,
  sessionId: string
): Promise<string | null> {
  if (!prompt.trim()) return null;

  const tags = getTags(directory);
  const search = await memoryClient.searchMemories(prompt, tags.project.tag);
  if (!search.success) return null;

  const results = CONFIG.chatMessage.excludeCurrentSession
    ? search.results.filter((result: any) => result.metadata?.sessionID !== sessionId)
    : search.results;

  if (results.length === 0) return null;

  const memoryContext = await formatContextForPrompt(tags.user.userEmail || null, {
    results,
  });

  return memoryContext || null;
}
