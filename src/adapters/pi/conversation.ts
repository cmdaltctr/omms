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
 * Build the capture window for the most recent user prompt on the active
 * branch: only that prompt's assistant/tool work, stopping at the next user
 * message. Hidden thinking blocks are never included. Tool inputs are bounded
 * by the same truncation policy as the OpenCode adapter.
 *
 * Returns null when the branch has no user prompt or the prompt has no
 * assistant/tool response window yet.
 */
export function extractPiConversation(entries: PiSessionEntry[]): PiConversationWindow | null {
  let lastUserIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isUserEntry(entries[i]!)) {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex === -1) return null;

  const userEntry = entries[lastUserIndex]!;
  const userPrompt = entryText(userEntry.message?.content);
  if (!userPrompt) return null;

  const textResponses: string[] = [];
  const toolCalls: CaptureToolCall[] = [];
  const sourceEntryIds: string[] = [];
  let sourceTimestamp: number | undefined;

  for (const entry of entries.slice(lastUserIndex + 1)) {
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

  return {
    userEntryId: userEntry.id,
    userPrompt,
    textResponses,
    toolCalls,
    sourceEntryIds,
    ...(sourceTimestamp !== undefined ? { sourceTimestamp } : {}),
  };
}
