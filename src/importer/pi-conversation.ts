import type { CaptureConversation, CaptureToolCall } from "../core/host.js";
import { boundToolInput, readToolPath } from "../core/tool-input.js";
import { errorOutcome } from "../core/tool-outcome.js";

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
    /** Set on `toolResult` messages: the `id` of the matching `toolCall` block. */
    toolCallId?: string;
    /** Set on `toolResult` messages. */
    isError?: boolean;
  };
}

export interface PiContentBlock {
  type: string;
  id?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

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

function isToolResultEntry(entry: PiSessionEntry): boolean {
  return entry.type === "message" && entry.message?.role === "toolResult";
}

/**
 * Set the outcome of the call a `toolResult` entry answers. Only the error
 * text of a failed call is kept; a successful call's output is never stored.
 */
function applyToolResult(entry: PiSessionEntry, callsById: Map<string, CaptureToolCall>): void {
  const call = callsById.get(entry.message?.toolCallId ?? "");
  if (!call) return;
  if (entry.message?.isError === true) {
    Object.assign(call, errorOutcome(entryText(entry.message.content)));
  } else {
    call.outcome = "ok";
  }
}

function formatToolInput(args: unknown): string {
  if (!args) return "";
  return Object.entries(args as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");
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
  const callsById = new Map<string, CaptureToolCall>();
  let sourceTimestamp: number | undefined;

  for (const entry of entries.slice(userIndex + 1)) {
    if (isUserEntry(entry)) break;
    if (isToolResultEntry(entry)) applyToolResult(entry, callsById);
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
      // A call stays `unknown` until a `toolResult` entry answers it.
      const call: CaptureToolCall = {
        name,
        input: boundToolInput(formatToolInput(block.arguments)),
        outcome: "unknown",
      };
      const path = readToolPath(name, block.arguments);
      if (path !== undefined) call.path = path;
      toolCalls.push(call);
      if (typeof block.id === "string") callsById.set(block.id, call);
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
