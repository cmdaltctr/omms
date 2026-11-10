import { CONFIG } from "../config.js";
import { formatContextForPrompt } from "../services/context.js";
import { memoryClient } from "../services/client.js";
import { getTags } from "../services/tags.js";
import { isFullyPrivate, stripPrivateContent } from "../services/privacy.js";
import { utf8ByteLength } from "../utils/context-limit.js";
import { packContextSection, type ContextBudgetOptions } from "./context-budget.js";

export const RETRIEVAL_SECTION_TAG = "omms-retrieval";

/**
 * The search step of every query-driven section (`buildRetrievalSection` and
 * the opening search in `opening-context.ts`), so they share one rule set: the
 * store applies the result limit and the relevance threshold, then memories
 * from the current session are dropped when `chatMessage.excludeCurrentSession`
 * is on. Returns null when the search failed.
 */
export async function searchSectionMemories(
  query: string,
  projectTag: string,
  sessionId: string
): Promise<{ results: any[]; queryVector?: ArrayLike<number> } | null> {
  // Snapshot before the async search: an excludeCurrentSession edit during
  // the search must not change this operation's filtering.
  const excludeCurrentSession = CONFIG.chatMessage.excludeCurrentSession;

  // Recall reads linked spaces too (D6); capture and profile steps keep the default.
  const search = await memoryClient.searchMemories(query, projectTag, "project", {
    includeLinked: true,
  });
  if (!search.success) return null;

  const results = excludeCurrentSession
    ? search.results.filter((result: any) => result.metadata?.sessionID !== sessionId)
    : search.results;
  return { results, queryVector: search.queryVector };
}

/**
 * Pi expands `/skill:<name> text` into `<skill ...>skill body</skill>` followed by the user's text.
 * The search uses the user's own words, so the whole block is cut out.
 */
const SKILL_BLOCK = /<skill\b[^>]*>[\s\S]*?<\/skill>/gi;

/**
 * The prompt text that may reach a search: skill blocks and `<private>` regions removed. Null when
 * nothing is left, so a fully private prompt, or a skill run with no text of its own, runs no
 * search and nothing of it reaches an embedding provider.
 */
export function searchablePrompt(prompt: string): string | null {
  const text = prompt.replace(SKILL_BLOCK, "");
  if (isFullyPrivate(text)) return null;
  return stripPrivateContent(text).trim() || null;
}

/**
 * Prompt-aware semantic retrieval shared by every host (Pi `before_agent_start`,
 * OpenCode v2 `prompt`/`context` hooks): search the shared project memory with
 * the incoming prompt and format a bounded context section (memory + user
 * profile). Returns null when nothing relevant is found.
 */
export async function buildRetrievalSection(
  prompt: string,
  directory: string,
  sessionId: string,
  budget?: ContextBudgetOptions
): Promise<string | null> {
  const query = searchablePrompt(prompt);
  if (!query) return null;

  const tags = getTags(directory);
  const search = await searchSectionMemories(query, tags.project.tag, sessionId);
  if (!search || search.results.length === 0) return null;

  const memoryContext = await formatContextForPrompt(
    tags.user.userEmail || null,
    { results: search.results },
    budget,
    search.queryVector
  );

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
  /** Shared packing budget; hosts pass the snapshotted `retrievalMaxTokens`. */
  budget?: ContextBudgetOptions;
}

/**
 * The project's most recent memories as a context section, shared by every host
 * that injects them at session start (OpenCode's first `chat.message`, Claude
 * Code `SessionStart`). Returns null when no memory qualifies.
 */
export async function buildRecentMemoriesSection(
  options: RecentMemoriesOptions
): Promise<string | null> {
  const listResult = await memoryClient.listMemories(
    options.projectTag,
    options.maxMemories,
    "project",
    { includeLinked: true }
  );

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
      id: m.id,
      similarity: 1.0,
      memory: m.summary,
    })),
    total: memories.length,
    timing: 0,
  };

  const memoryContext = await formatContextForPrompt(
    options.userEmail || null,
    projectMemories,
    options.budget
  );

  return memoryContext || null;
}

/** Delimit a retrieval section so it is recognisable as injected memory, not user text. */
export function wrapRetrievalSection(section: string): string {
  return `<${RETRIEVAL_SECTION_TAG}>\n${section}\n</${RETRIEVAL_SECTION_TAG}>`;
}

/** Byte overhead the `omms-retrieval` wrapper adds around one section. */
export function retrievalWrapperBytes(): number {
  return utf8ByteLength(wrapRetrievalSection(""));
}

// Only a closed section is injected context: `wrapRetrievalSection` always closes it, and the
// Claude Code hook keeps the closing tag when it truncates. An unclosed tag is user text.
const RETRIEVAL_SECTION_RE = new RegExp(
  `<${RETRIEVAL_SECTION_TAG}>[\\s\\S]*?</${RETRIEVAL_SECTION_TAG}>`,
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

/** Format a session's own memories for re-injection after compaction, within the budget. */
export function formatMemoriesForCompaction(
  memories: any[],
  budget?: ContextBudgetOptions
): string {
  const entries = memories.map((m, i) => {
    const tags = Array.isArray(m.tags) ? m.tags : [];
    const body =
      tags.length > 0 ? stripMatchingEmbeddedTagsFooter(m.memory ?? "", tags) : (m.memory ?? "");
    const tagsFooter = tags.length > 0 ? `Tags: ${tags.join(", ")}\n\n` : "";
    return {
      prefix: m.id ? `### Memory ${i + 1} (${m.id})\n` : `### Memory ${i + 1}\n`,
      body,
      suffix: `\n\n${tagsFooter}`,
    };
  });

  return packContextSection({
    ...(budget ?? {}),
    header: `## Restored Session Memory\n\n`,
    blocks: [{ prefix: "", suffix: "", entries }],
  }).text;
}
