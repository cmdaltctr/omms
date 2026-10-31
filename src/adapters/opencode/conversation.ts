import type { CaptureConversation, CaptureToolCall } from "../../core/host.js";
import { boundToolInput, readToolPath } from "../../core/tool-input.js";
import { opencodeToolOutcome } from "../../core/tool-outcome.js";

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

export function extractOpenCodeConversation(
  messages: any[],
  promptMessageId: string
): CaptureConversation | null {
  const promptIndex = messages.findIndex((message) => message.info?.id === promptMessageId);
  if (promptIndex === -1) return null;

  const responseMessages: any[] = [];
  for (const message of messages.slice(promptIndex + 1)) {
    if (message.info?.role === "user") break;
    responseMessages.push(message);
  }

  const textResponses: string[] = [];
  const toolCalls: CaptureToolCall[] = [];
  const sourceEntryIds: string[] = [];

  for (const message of responseMessages) {
    if (message.info?.role !== "assistant") continue;
    if (typeof message.info?.id === "string") sourceEntryIds.push(message.info.id);
    if (!Array.isArray(message.parts)) continue;

    const textParts = message.parts.filter(
      (part: any) => part.type === "text" && typeof part.text === "string" && part.text.trim()
    );
    if (textParts.length > 0) {
      textResponses.push(
        textParts
          .map((part: any) => part.text)
          .join("\n")
          .trim()
      );
    }

    for (const tool of message.parts.filter((part: any) => part.type === "tool")) {
      const name = tool.tool || "unknown";
      const input = boundToolInput(formatToolInput(tool.state?.input));
      const path = readToolPath(name, tool.state?.input);
      toolCalls.push({
        name,
        input,
        ...opencodeToolOutcome(tool.state),
        ...(path === undefined ? {} : { path }),
      });
    }
  }

  return { textResponses, toolCalls, sourceEntryIds };
}
