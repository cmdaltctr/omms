import type { CaptureConversation, CaptureToolCall } from "../../core/host.js";

/**
 * Minimal structural view of Pi session entries (see Pi session-format docs).
 * Kept structural so the normaliser stays testable without importing Pi types.
 */
export interface PiSessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: {
    role?: string;
    content?: string | PiContentBlock[];
  };
}

export interface PiContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

const MAX_TOOL_INPUT_LENGTH = 100;

export interface PiConversationWindow extends CaptureConversation {
  userEntryId: string;
  userPrompt: string;
  userTimestamp?: number;
}

function entryText(content: string | PiContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function isUserEntry(entry: PiSessionEntry): boolean {
  return entry.type === "message" && entry.message?.role === "user";
}

function isAssistantEntry(entry: PiSessionEntry): boolean {
  return entry.type === "message" && entry.message?.role === "assistant";
}

function formatToolInput(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  return Object.entries(args)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");
}

function boundToolInput(input: string): string {
  if (input.length > MAX_TOOL_INPUT_LENGTH) {
    return input.substring(0, MAX_TOOL_INPUT_LENGTH) + "...";
  }
  return input;
}

/**
 * Build the capture window for the user entry at `userIndex`: only that
 * prompt's assistant/tool work, stopping at the next user message. Hidden
 * thinking blocks are never included. Tool inputs are bounded by the same
 * truncation policy as the OpenCode adapter.
 *
 * Returns null when the prompt is empty or has no assistant/tool response
 * window yet.
 */
function buildWindow(entries: PiSessionEntry[], userIndex: number): PiConversationWindow | null {
  const userEntry = entries[userIndex]!;
  const userPrompt = entryText(userEntry.message?.content);
  if (!userPrompt) return null;

  const textResponses: string[] = [];
  const toolCalls: CaptureToolCall[] = [];
  const sourceEntryIds: string[] = [];
  let sourceTimestamp: number | undefined;

  for (const entry of entries.slice(userIndex + 1)) {
    if (isUserEntry(entry)) break;
    if (!isAssistantEntry(entry)) continue;

    if (typeof entry.id === "string") sourceEntryIds.push(entry.id);
    const timestampMs = Date.parse(entry.timestamp);
    if (!Number.isNaN(timestampMs)) sourceTimestamp = timestampMs;

    const blocks = entry.message?.content;
    if (!Array.isArray(blocks)) continue;

    const textParts = blocks.filter(
      (block) => block.type === "text" && typeof block.text === "string" && block.text.trim()
    );
    if (textParts.length > 0) {
      textResponses.push(
        textParts
          .map((block) => block.text)
          .join("\n")
          .trim()
      );
    }

    for (const block of blocks.filter((item) => item.type === "toolCall")) {
      const name = typeof block.name === "string" ? block.name : "unknown";
      toolCalls.push({
        name,
        input: boundToolInput(formatToolInput(block.arguments)),
      });
    }
  }

  if (textResponses.length === 0 && toolCalls.length === 0) return null;

  const userTimestampMs = Date.parse(userEntry.timestamp);

  return {
    userEntryId: userEntry.id,
    userPrompt,
    textResponses,
    toolCalls,
    sourceEntryIds,
    ...(sourceTimestamp !== undefined ? { sourceTimestamp } : {}),
    ...(Number.isNaN(userTimestampMs) ? {} : { userTimestamp: userTimestampMs }),
  };
}

/**
 * All capture windows on the branch, oldest first: one per user prompt that
 * produced assistant or tool work. Used by live capture (last window) and by
 * the historical importer (all windows).
 */
export function extractPiConversationWindows(entries: PiSessionEntry[]): PiConversationWindow[] {
  const windows: PiConversationWindow[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (!isUserEntry(entries[i]!)) continue;
    const window = buildWindow(entries, i);
    if (window) windows.push(window);
  }
  return windows;
}

/**
 * The capture window of the most recent user prompt on the branch. Returns
 * null when the branch has no user prompt with a response window.
 */
export function extractPiConversation(entries: PiSessionEntry[]): PiConversationWindow | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (!isUserEntry(entries[i]!)) continue;
    return buildWindow(entries, i);
  }
  return null;
}
