import { CONFIG } from "../config.js";
import { formatContextForPrompt } from "../services/context.js";
import { memoryClient } from "../services/client.js";
import { getTags } from "../services/tags.js";

export const RETRIEVAL_SECTION_TAG = "omms-retrieval";

/**
 * Prompt-aware semantic retrieval shared by every host (Pi `before_agent_start`,
 * OpenCode v2 `prompt`/`context` hooks): search the shared project memory with
 * the incoming prompt and format a bounded context section (memory + user
 * profile). Returns null when nothing relevant is found.
 */
export async function buildRetrievalSection(
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

export interface RecentMemoriesOptions {
  /** Project container tag, from `getTags(directory).project.tag`. */
  projectTag: string;
  /** Profile owner, from `getTags(directory).user.userEmail`. */
  userEmail: string | null | undefined;
  sessionId: string;
  /** `CONFIG.chatMessage.maxMemories` */
  maxMemories?: number;
  /** `CONFIG.chatMessage.excludeCurrentSession` */
  excludeCurrentSession?: boolean;
  /** `CONFIG.chatMessage.maxAgeDays` */
  maxAgeDays?: number;
}

/**
 * The project's most recent memories as a context section, shared by every host
 * that injects them at session start (OpenCode's first `chat.message`, Claude
 * Code `SessionStart`). Returns null when no memory qualifies.
 */
export async function buildRecentMemoriesSection(
  options: RecentMemoriesOptions
): Promise<string | null> {
  const listResult = await memoryClient.listMemories(options.projectTag, options.maxMemories);

  let memories = listResult.success ? listResult.memories : [];

  if (options.excludeCurrentSession) {
    memories = memories.filter((m: any) => m.metadata?.sessionID !== options.sessionId);
  }

  if (options.maxAgeDays) {
    const cutoffDate = Date.now() - options.maxAgeDays * 86400000;
    memories = memories.filter((m: any) => new Date(m.createdAt).getTime() > cutoffDate);
  }

  if (memories.length === 0) return null;

  const projectMemories = {
    results: memories.map((m: any) => ({
      similarity: 1.0,
      memory: m.summary,
    })),
    total: memories.length,
    timing: 0,
  };

  const memoryContext = await formatContextForPrompt(options.userEmail || null, projectMemories);

  return memoryContext || null;
}

/** Delimit a retrieval section so it is recognisable as injected memory, not user text. */
export function wrapRetrievalSection(section: string): string {
  return `<${RETRIEVAL_SECTION_TAG}>\n${section}\n</${RETRIEVAL_SECTION_TAG}>`;
}

// An unclosed section runs to the end, as a truncated injection would.
const RETRIEVAL_SECTION_RE = new RegExp(
  `<${RETRIEVAL_SECTION_TAG}>[\\s\\S]*?(?:</${RETRIEVAL_SECTION_TAG}>|$)`,
  "g"
);

/** Remove injected retrieval sections, so injected memories are never captured as user text. */
export function stripRetrievalSections(text: string): string {
  return text.replace(RETRIEVAL_SECTION_RE, "").trim();
}

const EMBEDDED_TAGS_FOOTER_RE = /\n*Tags: ([^\n]*)\s*$/;

function normalizeTagsKey(tags: string[]): string {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .sort()
    .join("\0");
}

function stripMatchingEmbeddedTagsFooter(memory: string, tags: string[]): string {
  const match = memory.match(EMBEDDED_TAGS_FOOTER_RE);
  if (!match) {
    return memory;
  }

  const footerValue = match[1];
  if (footerValue === undefined) {
    return memory;
  }

  const embeddedTags = footerValue
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  if (normalizeTagsKey(embeddedTags) !== normalizeTagsKey(tags)) {
    return memory;
  }

  return memory.replace(EMBEDDED_TAGS_FOOTER_RE, "");
}

/** Format a session's own memories for re-injection after compaction. */
export function formatMemoriesForCompaction(memories: any[]): string {
  let output = `## Restored Session Memory\n\n`;

  memories.forEach((m, i) => {
    const tags = Array.isArray(m.tags) ? m.tags : [];
    const body =
      tags.length > 0 ? stripMatchingEmbeddedTagsFooter(m.memory ?? "", tags) : (m.memory ?? "");

    output += `### Memory ${i + 1}\n`;
    output += `${body}\n\n`;
    if (tags.length > 0) {
      output += `Tags: ${tags.join(", ")}\n\n`;
    }
  });

  return output;
}
