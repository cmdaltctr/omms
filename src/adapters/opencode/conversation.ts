import type { CaptureConversation, CaptureToolCall } from "../../core/host.js";
import { boundToolInput, readToolPath } from "../../core/tool-input.js";
import { opencodeMemorise, opencodeToolOutcome } from "../../core/tool-outcome.js";

function formatToolInput(inputValue: unknown): string {
  if (!inputValue) return "";
  if (typeof inputValue === "string") return inputValue;
  if (typeof inputValue === "object") {
    return Object.entries(inputValue)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(", ");
  }
  return "";
}

/** Message types that start a new turn: the user's prompt and messages sent for the user. */
const TURN_START_TYPES = new Set(["user", "synthetic", "system"]);

/**
 * The reply to one prompt from OpenCode V2 session messages (`ctx.session.context`):
 * the assistant messages after the prompt, up to the next user, synthetic or system message.
 */
export function extractOpenCodeConversation(
  messages: readonly any[],
  promptMessageId: string
): CaptureConversation | null {
  const promptIndex = messages.findIndex((message) => message?.id === promptMessageId);
  if (promptIndex === -1) return null;

  const textResponses: string[] = [];
  const toolCalls: CaptureToolCall[] = [];
  const sourceEntryIds: string[] = [];

  for (const message of messages.slice(promptIndex + 1)) {
    if (TURN_START_TYPES.has(message?.type)) break;
    if (message?.type !== "assistant") continue;
    if (typeof message.id === "string") sourceEntryIds.push(message.id);
    const content: any[] = Array.isArray(message.content) ? message.content : [];

    const text = content
      .filter((part) => part?.type === "text" && typeof part.text === "string" && part.text.trim())
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) textResponses.push(text);

    for (const tool of content.filter((part) => part?.type === "tool")) {
      const name = tool.name || "unknown";
      const input = boundToolInput(formatToolInput(tool.state?.input));
      const path = readToolPath(name, tool.state?.input);
      toolCalls.push({
        name,
        input,
        ...opencodeToolOutcome(tool.state),
        ...opencodeMemorise(name, tool.state?.input, tool.state),
        ...(path === undefined ? {} : { path }),
      });
    }
  }

  return { textResponses, toolCalls, sourceEntryIds };
}
