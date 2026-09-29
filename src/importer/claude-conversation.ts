import type { CaptureToolCall } from "../core/host.js";
import type { ImportWindow } from "./importer.js";

/**
 * Pure parsing of Claude Code session transcripts
 * (`~/.claude/projects/<project-folder>/<session-id>.jsonl`). The format is
 * internal to Claude Code and changes between versions, so the view below is
 * structural and minimal. It was written against Claude Code v2.1.284 and is
 * pinned by the fixtures in `tests/fixtures/claude-transcripts/`.
 *
 * Live capture and the history import both build their work units here.
 */

export interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

export interface ClaudeTranscriptEntry {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  version?: string;
  message?: {
    id?: string;
    role?: string;
    content?: string | ClaudeContentBlock[];
  };
}

/**
 * Entry types seen in real transcripts. A line with any other type is skipped
 * and counted, so a new Claude Code version shows up in the import report.
 */
const KNOWN_ENTRY_TYPES = new Set([
  "user",
  "assistant",
  "system",
  "attachment",
  "summary",
  "file-history-snapshot",
  "file-history-delta",
  "last-prompt",
  "mode",
  "permission-mode",
  "ai-title",
  "custom-title",
  "pr-link",
  "queue-operation",
  "cost-state",
  "agent-name",
  "atis-latch",
]);

/**
 * User entries that Claude Code writes itself: local command output, bash
 * mode, and background task notices. They end the current turn but never
 * start one.
 */
const NOISE_PREFIXES = [
  "<local-command-stdout>",
  "<local-command-stderr>",
  "<local-command-caveat>",
  "<bash-input>",
  "<bash-stdout>",
  "<bash-stderr>",
  "<task-notification>",
];

const MAX_TOOL_INPUT_LENGTH = 100;

export type ClaudeLineResult =
  | { status: "entry"; entry: ClaudeTranscriptEntry }
  | { status: "unknown-type" }
  | { status: "unreadable" }
  | { status: "blank" };

export interface ParsedClaudeTranscript {
  entries: ClaudeTranscriptEntry[];
  unreadableLines: number;
  unknownTypes: number;
}

export interface ClaudeConversationWindow extends ImportWindow {
  /** Working directory recorded on the prompt entry. */
  cwd: string | null;
}

/** Parse one transcript line. A JSON value without a string `type` is unreadable. */
export function parseClaudeTranscriptLine(line: string): ClaudeLineResult {
  if (!line.trim()) return { status: "blank" };
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { status: "unreadable" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "unreadable" };
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") return { status: "unreadable" };
  if (!KNOWN_ENTRY_TYPES.has(type)) return { status: "unknown-type" };
  return { status: "entry", entry: value as ClaudeTranscriptEntry };
}

/** Parse a whole transcript, counting the lines that were skipped. */
export function parseClaudeTranscript(text: string): ParsedClaudeTranscript {
  const result: ParsedClaudeTranscript = { entries: [], unreadableLines: 0, unknownTypes: 0 };
  for (const line of text.split("\n")) {
    const parsed = parseClaudeTranscriptLine(line);
    if (parsed.status === "entry") result.entries.push(parsed.entry);
    else if (parsed.status === "unreadable") result.unreadableLines++;
    else if (parsed.status === "unknown-type") result.unknownTypes++;
  }
  return result;
}

function blocksOf(entry: ClaudeTranscriptEntry): ClaudeContentBlock[] {
  const content = entry.message?.content;
  return Array.isArray(content)
    ? content.filter((block) => block && typeof block === "object")
    : [];
}

function promptText(entry: ClaudeTranscriptEntry): string {
  const content = entry.message?.content;
  if (typeof content === "string") return content.trim();
  return blocksOf(entry)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * A user entry that ends the current turn: in the main chain, not written by
 * Claude Code as context (`isMeta`), and not a tool result.
 */
function isTurnBoundary(entry: ClaudeTranscriptEntry): boolean {
  if (entry.type !== "user" || entry.isMeta === true || entry.isSidechain === true) return false;
  return !blocksOf(entry).some((block) => block.type === "tool_result");
}

/** Show a slash command as the user typed it: `/name args`. */
function slashCommandText(text: string): string | null {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]?.trim();
  if (!name) return null;
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim();
  return args ? `${name} ${args}` : name;
}

/** The prompt a boundary entry starts, or null for Claude Code's own noise. */
function turnPrompt(entry: ClaudeTranscriptEntry): string | null {
  const text = promptText(entry);
  if (!text) return null;
  if (NOISE_PREFIXES.some((prefix) => text.startsWith(prefix))) return null;
  return slashCommandText(text) ?? text;
}

function formatToolInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "object" || Array.isArray(input)) return JSON.stringify(input);
  return Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");
}

function boundToolInput(input: string): string {
  if (input.length > MAX_TOOL_INPUT_LENGTH) {
    return input.substring(0, MAX_TOOL_INPUT_LENGTH) + "...";
  }
  return input;
}

interface OpenWindow {
  entryIndex: number;
  entry: ClaudeTranscriptEntry;
  userPrompt: string;
  textResponses: string[];
  toolCalls: CaptureToolCall[];
  sourceEntryIds: string[];
}

function closeWindow(open: OpenWindow): ClaudeConversationWindow | null {
  if (open.textResponses.length === 0 && open.toolCalls.length === 0) return null;
  const timestamp = Date.parse(open.entry.timestamp ?? "");
  return {
    userEntryId: open.entry.uuid!,
    userPrompt: open.userPrompt,
    textResponses: open.textResponses,
    toolCalls: open.toolCalls,
    sourceEntryIds: open.sourceEntryIds,
    cwd: typeof open.entry.cwd === "string" ? open.entry.cwd : null,
    ...(Number.isNaN(timestamp) ? {} : { userTimestamp: timestamp, sourceTimestamp: timestamp }),
  };
}

function addAssistantWork(open: OpenWindow, entry: ClaudeTranscriptEntry): void {
  if (typeof entry.uuid === "string") open.sourceEntryIds.push(entry.uuid);
  const blocks = blocksOf(entry);
  const text = blocks
    .filter((block) => block.type === "text" && typeof block.text === "string" && block.text.trim())
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (text) open.textResponses.push(text);
  for (const block of blocks.filter((item) => item.type === "tool_use")) {
    open.toolCalls.push({
      name: typeof block.name === "string" ? block.name : "unknown",
      input: boundToolInput(formatToolInput(block.input)),
    });
  }
}

function windowsWithIndex(
  entries: ClaudeTranscriptEntry[]
): Array<{ entryIndex: number; window: ClaudeConversationWindow }> {
  const result: Array<{ entryIndex: number; window: ClaudeConversationWindow }> = [];
  let open: OpenWindow | null = null;
  const flush = () => {
    const window = open ? closeWindow(open) : null;
    if (open && window) result.push({ entryIndex: open.entryIndex, window });
    open = null;
  };

  entries.forEach((entry, entryIndex) => {
    if (isTurnBoundary(entry)) {
      flush();
      const userPrompt = turnPrompt(entry);
      if (userPrompt && typeof entry.uuid === "string") {
        open = {
          entryIndex,
          entry,
          userPrompt,
          textResponses: [],
          toolCalls: [],
          sourceEntryIds: [entry.uuid],
        };
      }
      return;
    }
    if (open && entry.type === "assistant" && entry.isSidechain !== true) {
      addAssistantWork(open, entry);
    }
  });
  flush();
  return result;
}

/**
 * All capture windows in a transcript, oldest first: one per user prompt that
 * produced assistant text or tool work. Sidechain (subagent) entries, meta
 * entries, and tool results are skipped; tool results and meta entries do not
 * end a turn. Thinking blocks are never included. Tool inputs are bounded by
 * the same truncation policy as the other hosts.
 */
export function extractClaudeConversationWindows(
  entries: ClaudeTranscriptEntry[]
): ClaudeConversationWindow[] {
  return windowsWithIndex(entries).map((item) => item.window);
}

/**
 * Windows for live capture: every window whose prompt comes after the cursor
 * entry. Without a cursor, or when the cursor is no longer in the transcript,
 * only the last window is returned, so a lost cursor never re-captures a
 * whole session.
 */
export function extractClaudeWindowsAfter(
  entries: ClaudeTranscriptEntry[],
  cursorUserUuid: string | null
): ClaudeConversationWindow[] {
  const windows = windowsWithIndex(entries);
  const cursorIndex =
    cursorUserUuid === null ? -1 : entries.findIndex((entry) => entry.uuid === cursorUserUuid);
  if (cursorIndex === -1) return windows.slice(-1).map((item) => item.window);
  return windows.filter((item) => item.entryIndex > cursorIndex).map((item) => item.window);
}
