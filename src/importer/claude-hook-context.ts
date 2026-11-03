import { open, readFile, stat } from "node:fs/promises";
import { CONFIG } from "../config.js";
import type { ContextBudgetOptions } from "../core/context-budget.js";
import { buildFirstPromptSections, openingQueryFor } from "../core/opening-context.js";
import {
  RETRIEVAL_SECTION_TAG,
  buildRetrievalSection,
  retrievalWrapperBytes,
  wrapRetrievalSection,
} from "../core/retrieval.js";
import { isFullyPrivate, stripPrivateContent } from "../services/privacy.js";
import { utf8ByteLength } from "../utils/context-limit.js";
import { parseClaudeTranscript, type ClaudeTranscriptEntry } from "./claude-conversation.js";

// What the Claude Code hooks add beyond a plain retrieval section (change
// align-recall-host-parity): the rows-off marker, the opening section for the
// first prompt of a session, and the task memories for a subagent. The hook
// reaches the recall rows only through the injected text, so the markers are
// HTML comments on the line after a section's opening tag. They hold no memory
// text. Logs here carry sizes and codes, never text.

/** Tells the recall rows to draw nothing for this section. 21 bytes, newline included. */
export const ROWS_OFF_MARKER = "<!--omms:rows-off-->\n";

/** Between the prompt's section and the opening section. */
const SECTION_SEPARATOR = "\n";
const OPENING_QUERY_MAX = 300;
/** Sessions this process remembers, so the transcript check runs once per session. */
const SEEN_SESSIONS_MAX = 500;
/** A transcript this large already holds earlier prompts, or is too big to scan. */
const FIRST_PROMPT_SCAN_MAX_BYTES = 1024 * 1024;
const SUBAGENT_TAIL_BYTES = 1024 * 1024;

/** The byte budget of one request and whether recall rows are off for it. */
export interface SectionLimits {
  budgetBytes: number;
  rowsOff: boolean;
}

/** Read `visibleRecall` once per request, after the config refresh. */
export function sectionLimits(budgetBytes: number): SectionLimits {
  return { budgetBytes, rowsOff: CONFIG.visibleRecall === false };
}

/** The budget for one packed section: the retrieval tag, and the rows-off marker when set, are reserved. */
export function sectionBudget(limits: SectionLimits): ContextBudgetOptions {
  const marker = limits.rowsOff ? utf8ByteLength(ROWS_OFF_MARKER) : 0;
  return { maxBytes: limits.budgetBytes, wrapperBytes: retrievalWrapperBytes() + marker };
}

/** Put a marker line right after the opening tag of a wrapped section. */
export function insertMarker(wrapped: string, marker: string): string {
  const head = `<${RETRIEVAL_SECTION_TAG}>\n`;
  return wrapped.startsWith(head) ? head + marker + wrapped.slice(head.length) : wrapped;
}

/** Wrap a packed section, with the rows-off marker when rows are off. */
export function wrapSection(section: string, limits: SectionLimits): string {
  const wrapped = wrapRetrievalSection(section);
  return limits.rowsOff ? insertMarker(wrapped, ROWS_OFF_MARKER) : wrapped;
}

/**
 * The opening marker. The query goes on one line, with `"`, `<` and `>`
 * removed, `--` folded to `-` and 300 characters at most, so it cannot end the
 * comment early.
 */
export function openingMarker(query: string): string {
  const line = query
    .replace(/["<>]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, OPENING_QUERY_MAX)
    // Do not leave half of a surrogate pair at the cut.
    .replace(/[\uD800-\uDBFF]$/, "");
  return `<!--omms:opening query="${line}"-->\n`;
}

// --- First prompt of a session ---

const seenSessions = new Set<string>();

/** Remember a session, so a later prompt in this process is never first. Oldest ids drop out. */
export function markSessionSeen(sessionId: string): void {
  seenSessions.delete(sessionId);
  seenSessions.add(sessionId);
  if (seenSessions.size > SEEN_SESSIONS_MAX) {
    seenSessions.delete(seenSessions.values().next().value as string);
  }
}

// User entries that Claude Code writes itself (command output, shell mode,
// background task notices) are not prompts.
const NOT_PROMPT_PREFIXES = ["<local-command-", "<command-name>", "<bash-", "<task-notification>"];

function contentBlocks(entry: ClaudeTranscriptEntry) {
  const content = entry.message?.content;
  return Array.isArray(content)
    ? content.filter((block) => block && typeof block === "object")
    : [];
}

/** The text of a prompt the user typed, or null for any other transcript entry. */
function userPromptText(entry: ClaudeTranscriptEntry): string | null {
  if (entry.type !== "user" || entry.isMeta === true || entry.isSidechain === true) return null;
  const content = entry.message?.content;
  let text: string;
  if (typeof content === "string") text = content;
  else {
    const blocks = contentBlocks(entry);
    if (blocks.some((block) => block.type === "tool_result")) return null;
    text = blocks.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("\n");
  }
  text = text.trim();
  return text && !NOT_PROMPT_PREFIXES.some((prefix) => text.startsWith(prefix)) ? text : null;
}

/**
 * True when the transcript holds no user prompt before `prompt`. The host may
 * or may not have written the current prompt yet, so a last prompt with the same
 * text is not counted. A missing file is a session with no history. Any other
 * problem counts as not first, so the opening section is skipped.
 */
async function hasNoEarlierPrompt(transcriptPath: string, prompt: string): Promise<boolean> {
  let text: string;
  try {
    if ((await stat(transcriptPath)).size > FIRST_PROMPT_SCAN_MAX_BYTES) return false;
    text = await readFile(transcriptPath, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT";
  }
  const earlier = parseClaudeTranscript(text)
    .entries.map(userPromptText)
    .filter((entry): entry is string => entry !== null);
  if (earlier.at(-1) === prompt.trim()) earlier.pop();
  return earlier.length === 0;
}

/**
 * The first prompt of a session, as far as this process can tell: the session
 * is new to this process and its transcript holds no earlier prompt. Marks the
 * session seen. A missing or invalid transcript path counts as not first.
 */
async function isFirstPrompt(
  sessionId: string,
  transcriptPath: string | undefined,
  prompt: string
): Promise<boolean> {
  if (seenSessions.has(sessionId)) return false;
  const first = transcriptPath ? await hasNoEarlierPrompt(transcriptPath, prompt) : false;
  markSessionSeen(sessionId);
  return first;
}

export interface PromptContextInput {
  prompt: string;
  cwd: string;
  sessionId: string;
  /** The checked transcript path, or undefined when the request had none or it failed the check. */
  transcriptPath: string | undefined;
}

/**
 * The added context for a prompt: its retrieval section, and on the first
 * prompt of a session, with `openingContext` on, the opening section after it.
 * Empty string when there is nothing to add.
 */
export async function promptContext(
  input: PromptContextInput,
  limits: SectionLimits
): Promise<string> {
  const prompt = stripPrivateContent(input.prompt).trim();
  if (!CONFIG.chatMessage.enabled || !prompt || isFullyPrivate(input.prompt)) return "";
  const budget = sectionBudget(limits);

  const openingQuery = openingQueryFor(CONFIG);
  const first =
    openingQuery !== null &&
    (await isFirstPrompt(input.sessionId, input.transcriptPath, input.prompt));
  if (!first) {
    const section = await buildRetrievalSection(prompt, input.cwd, input.sessionId, budget);
    return section ? wrapSection(section, limits) : "";
  }

  const marker = limits.rowsOff ? ROWS_OFF_MARKER : openingMarker(openingQuery);
  const { promptSection, openingSection } = await buildFirstPromptSections({
    prompt,
    openingQuery,
    directory: input.cwd,
    sessionId: input.sessionId,
    budget,
    // The rows-off marker is already in `wrapperBytes`; the opening marker and the
    // line between the two sections are extra.
    openingReserveBytes: (limits.rowsOff ? 0 : utf8ByteLength(marker)) + SECTION_SEPARATOR.length,
  });
  return [
    promptSection &&
      (limits.rowsOff ? insertMarker(promptSection, ROWS_OFF_MARKER) : promptSection),
    openingSection && insertMarker(openingSection, marker),
  ]
    .filter(Boolean)
    .join(SECTION_SEPARATOR);
}

// --- Subagents ---

/**
 * A background subagent's call gets this receipt as its tool result at launch, before the agent
 * runs. It is not an answer: the call is still the one whose agent is starting.
 */
const LAUNCH_RECEIPT_PREFIX = "Async agent launched";

function isLaunchReceipt(content: unknown): boolean {
  const text = Array.isArray(content)
    ? content.map((part) => (part as { text?: unknown })?.text ?? "").join("")
    : content;
  return typeof text === "string" && text.startsWith(LAUNCH_RECEIPT_PREFIX);
}

/**
 * The task prompt of the newest `Agent` or `Task` call of `agentType` that has no result yet.
 * A background launch receipt does not count as a result.
 */
async function subagentTaskPrompt(
  transcriptPath: string,
  agentType: string
): Promise<string | null> {
  const handle = await open(transcriptPath, "r");
  let text: string;
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, SUBAGENT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    text = buffer.toString("utf8");
  } finally {
    await handle.close();
  }
  const answered = new Set<string>();
  const calls: { id: string; type: string; prompt: string }[] = [];
  for (const entry of parseClaudeTranscript(text).entries) {
    if (entry.isSidechain === true) continue;
    for (const block of contentBlocks(entry)) {
      if (block.type === "tool_result" && block.tool_use_id && !isLaunchReceipt(block.content)) {
        answered.add(block.tool_use_id);
      }
      if (block.type !== "tool_use" || !block.id) continue;
      if (block.name !== "Agent" && block.name !== "Task") continue;
      const input = (block.input ?? {}) as { prompt?: unknown; subagent_type?: unknown };
      if (typeof input.prompt !== "string") continue;
      const type = typeof input.subagent_type === "string" && input.subagent_type;
      calls.push({ id: block.id, type: type || "general-purpose", prompt: input.prompt });
    }
  }
  return (
    calls.reverse().find((call) => call.type === agentType && !answered.has(call.id))?.prompt ??
    null
  );
}

export interface SubagentContextInput {
  cwd: string;
  sessionId: string;
  transcriptPath: string | undefined;
  agentType: string | undefined;
}

/**
 * The added context for a starting subagent: the retrieval section for its
 * task prompt, read from the parent transcript. Every subagent section carries
 * the rows-off marker. Any problem gives an empty string.
 */
export async function subagentContext(
  input: SubagentContextInput,
  budgetBytes: number
): Promise<string> {
  if (!CONFIG.subagentMemory || !CONFIG.chatMessage.enabled) return "";
  if (!input.transcriptPath || !input.agentType) return "";
  const task = await subagentTaskPrompt(input.transcriptPath, input.agentType).catch(() => null);
  const prompt = stripPrivateContent(task ?? "").trim();
  if (!task || !prompt || isFullyPrivate(task)) return "";
  const limits = { budgetBytes, rowsOff: true };
  const section = await buildRetrievalSection(
    prompt,
    input.cwd,
    input.sessionId,
    sectionBudget(limits)
  );
  return section ? wrapSection(section, limits) : "";
}
