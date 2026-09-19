import { describe, expect, it } from "bun:test";
import { extractPiConversation, type PiSessionEntry } from "../src/adapters/pi/conversation.js";

function userEntry(id: string, text: string): PiSessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T10:00:00.000Z",
    message: { role: "user", content: text },
  };
}

function assistantEntry(
  id: string,
  blocks: any[],
  timestamp = "2026-01-01T10:00:05.000Z"
): PiSessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: { role: "assistant", content: blocks },
  };
}

function toolResultEntry(id: string): PiSessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T10:00:06.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "bash",
      content: [{ type: "text", text: "huge output" }],
      isError: false,
    },
  } as PiSessionEntry;
}

describe("Pi conversation adapter", () => {
  it("captures only the settled prompt's assistant/tool window", () => {
    const result = extractPiConversation([
      userEntry("u-1", "first prompt"),
      assistantEntry("a-1", [{ type: "text", text: "first response" }]),
      userEntry("u-2", "second prompt"),
      assistantEntry("a-2", [{ type: "text", text: "second response" }]),
      assistantEntry("a-3", [{ type: "text", text: "more work" }]),
    ]);

    expect(result).not.toBeNull();
    expect(result?.userEntryId).toBe("u-2");
    expect(result?.userPrompt).toBe("second prompt");
    expect(result?.textResponses).toEqual(["second response", "more work"]);
    expect(result?.sourceEntryIds).toEqual(["a-2", "a-3"]);
  });

  it("captures the earlier window when capture runs before the next prompt", () => {
    const result = extractPiConversation([
      userEntry("u-1", "first prompt"),
      assistantEntry("a-1", [{ type: "text", text: "first response" }]),
    ]);

    expect(result?.userEntryId).toBe("u-1");
    expect(result?.textResponses).toEqual(["first response"]);
  });

  it("excludes hidden thinking and keeps visible text", () => {
    const result = extractPiConversation([
      userEntry("u-1", "prompt"),
      assistantEntry("a-1", [
        { type: "thinking", thinking: "hidden reasoning must not leak" },
        { type: "text", text: "visible answer" },
      ]),
    ]);

    expect(result?.textResponses).toEqual(["visible answer"]);
    expect(JSON.stringify(result)).not.toContain("hidden reasoning");
  });

  it("captures tool calls with bounded input and skips tool results", () => {
    const result = extractPiConversation([
      userEntry("u-1", "prompt"),
      assistantEntry("a-1", [
        { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "x".repeat(200) } },
      ]),
      toolResultEntry("tr-1"),
    ]);

    // formatToolInput serialises `command: "xxx…"` (211 chars), bounded to 100 + "..."
    const expectedInput = `command: "${"x".repeat(90)}...`;
    expect(result?.toolCalls).toEqual([{ name: "bash", input: expectedInput }]);
    expect(JSON.stringify(result)).not.toContain("huge output");
  });

  it("returns null when the last user prompt has no response window", () => {
    expect(extractPiConversation([userEntry("u-1", "prompt")])).toBeNull();
  });

  it("returns null when the branch has no user prompt", () => {
    expect(
      extractPiConversation([assistantEntry("a-1", [{ type: "text", text: "orphan" }])])
    ).toBeNull();
  });

  it("records the newest assistant timestamp as sourceTimestamp", () => {
    const result = extractPiConversation([
      userEntry("u-1", "prompt"),
      assistantEntry("a-1", [{ type: "text", text: "one" }], "2026-01-01T10:00:05.000Z"),
      assistantEntry("a-2", [{ type: "text", text: "two" }], "2026-01-01T10:00:09.000Z"),
    ]);

    expect(result?.sourceTimestamp).toBe(Date.parse("2026-01-01T10:00:09.000Z"));
  });

  it("ignores compaction entries inside the response window", () => {
    const result = extractPiConversation([
      userEntry("u-1", "prompt"),
      assistantEntry("a-1", [{ type: "text", text: "before compaction" }]),
      {
        type: "compaction",
        id: "c-1",
        parentId: "a-1",
        timestamp: "2026-01-01T10:00:06.000Z",
        summary: "summarised",
      },
      assistantEntry("a-2", [{ type: "text", text: "after compaction" }]),
    ]);

    expect(result?.textResponses).toEqual(["before compaction", "after compaction"]);
    expect(result?.sourceEntryIds).toEqual(["a-1", "a-2"]);
  });
});
