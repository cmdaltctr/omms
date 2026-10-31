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
    expect(result?.toolCalls).toEqual([
      { name: "read", input: 'path: "src/index.ts"', outcome: "unknown", path: "src/index.ts" },
    ]);
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

  it("sets each tool call's outcome from the part state", () => {
    const result = extractOpenCodeConversation(
      [
        { info: { id: "u", role: "user" }, parts: [{ type: "text", text: "go" }] },
        {
          info: { id: "a", role: "assistant" },
          parts: [
            { type: "tool", tool: "read", state: { status: "completed", input: { path: "a" } } },
            {
              type: "tool",
              tool: "bash",
              state: { status: "error", input: { command: "false" }, error: "exit code 1" },
            },
            { type: "tool", tool: "grep", state: { status: "running", input: { pattern: "x" } } },
          ],
        },
      ],
      "u"
    );

    expect(result?.toolCalls).toEqual([
      { name: "read", input: 'path: "a"', outcome: "ok", path: "a" },
      { name: "bash", input: 'command: "false"', outcome: "error", error: "exit code 1" },
      { name: "grep", input: 'pattern: "x"', outcome: "unknown" },
    ]);
  });

  it("cuts a long read input as before and keeps the full path in path", () => {
    const skillPath = `/tmp/skills/${"s".repeat(129)}/SKILL.md`;
    expect(skillPath.length).toBe(150);
    const result = extractOpenCodeConversation(
      [
        { info: { id: "u", role: "user" }, parts: [] },
        {
          info: { id: "a", role: "assistant" },
          parts: [
            {
              type: "tool",
              tool: "read",
              state: { status: "completed", input: { offset: 1, filePath: skillPath, limit: 50 } },
            },
          ],
        },
      ],
      "u"
    );

    const formatted = `offset: 1, filePath: ${JSON.stringify(skillPath)}, limit: 50`;
    expect(result?.toolCalls[0]?.input).toBe(formatted.substring(0, 100) + "...");
    expect(result?.toolCalls[0]?.path).toBe(skillPath);
  });

  it("bounds error text to 2,000 characters", () => {
    const result = extractOpenCodeConversation(
      [
        { info: { id: "u", role: "user" }, parts: [] },
        {
          info: { id: "a", role: "assistant" },
          parts: [
            { type: "tool", tool: "bash", state: { status: "error", error: "e".repeat(5000) } },
          ],
        },
      ],
      "u"
    );

    expect(result?.toolCalls[0]?.error?.length).toBe(2000);
  });
});
