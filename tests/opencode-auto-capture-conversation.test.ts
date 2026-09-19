import { describe, expect, it } from "bun:test";
import { extractOpenCodeConversation } from "../src/adapters/opencode/conversation.js";

describe("OpenCode conversation adapter", () => {
  it("normalizes only the assistant/tool window for the target prompt", () => {
    const result = extractOpenCodeConversation(
      [
        { info: { id: "u-1", role: "user" }, parts: [{ type: "text", text: "first" }] },
        {
          info: { id: "a-1", role: "assistant" },
          parts: [
            { type: "text", text: "done" },
            { type: "tool", tool: "read", state: { input: { path: "src/index.ts" } } },
          ],
        },
        {
          info: { id: "a-2", role: "assistant" },
          parts: [{ type: "text", text: "follow-up" }],
        },
        { info: { id: "u-2", role: "user" }, parts: [{ type: "text", text: "next" }] },
        {
          info: { id: "a-3", role: "assistant" },
          parts: [{ type: "text", text: "must not leak into the first window" }],
        },
      ],
      "u-1"
    );

    expect(result).not.toBeNull();
    expect(result?.textResponses).toEqual(["done", "follow-up"]);
    expect(result?.toolCalls).toEqual([{ name: "read", input: 'path: "src/index.ts"' }]);
    expect(result?.sourceEntryIds).toEqual(["a-1", "a-2"]);
  });

  it("returns null when the source prompt cannot be found", () => {
    expect(extractOpenCodeConversation([], "missing")).toBeNull();
  });

  it("keeps tool input bounded", () => {
    const result = extractOpenCodeConversation(
      [
        { info: { id: "u", role: "user" }, parts: [] },
        {
          info: { id: "a", role: "assistant" },
          parts: [{ type: "tool", tool: "bash", state: { input: "x".repeat(200) } }],
        },
      ],
      "u"
    );

    expect(result?.toolCalls[0]?.input.endsWith("...")).toBe(true);
    expect(result?.toolCalls[0]?.input.length).toBe(103);
  });
});
