import { describe, expect, it, mock } from "bun:test";
import type { CaptureSummaryRequest, CaptureToolCall } from "../src/core/host.js";
import type { ClaudeTranscriptEntry } from "../src/importer/claude-conversation.js";

// Memory capture must send the same request whether or not the readers set
// tool outcomes. Only `skills.db` uses `outcome` and `error`.
mock.module("../src/config.js", () => ({ CONFIG: {}, refreshConfigIfChanged: () => {} }));
mock.module("../src/services/logger.js", () => ({ log: () => {} }));
mock.module("../src/services/capture-diagnostics.js", () => ({
  buildCaptureAttemptRecord: () => ({}),
  emitCaptureAttempt: () => {},
}));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({ project: { tag: "omms_project_test", displayName: "test" } }),
}));
mock.module("../src/services/client.js", () => ({
  memoryClient: {
    listMemories: async () => ({ success: true, memories: [] }),
    addMemory: async () => ({ success: true, id: "m1" }),
  },
}));

const { captureConversation } = await import("../src/core/capture.js");
const { extractClaudeConversationWindows } = await import("../src/importer/claude-conversation.js");

const baseUnit = {
  host: "claude-code" as const,
  hostSessionId: "session-1",
  sourceType: "live-capture" as const,
  projectDirectory: "/tmp/project",
  userPrompt: "Run the checks and fix what fails",
  textResponses: ["The Bash call failed, so I fixed the script."],
};

async function captureRequest(toolCalls: CaptureToolCall[]) {
  let request: Omit<CaptureSummaryRequest, "diagnostics"> | undefined;
  await captureConversation(
    { ...baseUnit, toolCalls },
    {
      summarize: async ({ diagnostics: _diagnostics, ...rest }) => {
        request = rest;
        return { summary: "", type: "skip", tags: [] };
      },
    }
  );
  return request;
}

describe("memory capture prompt", () => {
  it("is the same with and without tool outcomes", async () => {
    const without = await captureRequest([
      { name: "Read", input: 'file_path: "a.ts"' },
      { name: "Bash", input: 'command: "bun run check"' },
    ]);
    const withOutcomes = await captureRequest([
      { name: "Read", input: 'file_path: "a.ts"', outcome: "ok" },
      {
        name: "Bash",
        input: 'command: "bun run check"',
        outcome: "error",
        error: "Exit code 1: lint failed",
      },
    ]);

    expect(without?.context).toContain("## Tools Used");
    expect(withOutcomes).toEqual(without!);
  });

  it("keeps a long read call's input and the prompt text as before the change", async () => {
    const skillPath = `/tmp/skills/${"s".repeat(129)}/SKILL.md`;
    const args = { limit: 50, file_path: skillPath };
    // The reader code before skill learning: format, then cut at 100 characters.
    const legacyInput =
      `limit: 50, file_path: ${JSON.stringify(skillPath)}`.substring(0, 100) + "...";

    const [window] = extractClaudeConversationWindows([
      {
        type: "user",
        uuid: "p1",
        timestamp: "2026-01-01T10:00:00.000Z",
        message: { role: "user", content: "Use the skill" },
      },
      {
        type: "assistant",
        uuid: "r1",
        timestamp: "2026-01-01T10:00:05.000Z",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "t", name: "Read", input: args }],
        },
      },
    ] as ClaudeTranscriptEntry[]);
    const readerCall = window!.toolCalls[0]!;
    expect(readerCall.input).toBe(legacyInput);
    expect(readerCall.path).toBe(skillPath);

    const fromReader = await captureRequest([readerCall]);
    const legacy = await captureRequest([{ name: "Read", input: legacyInput }]);
    expect(fromReader?.context).toBe(legacy!.context);
    expect(fromReader?.context).toContain(`- Read(${legacyInput})`);
    expect(fromReader?.context).not.toContain(skillPath);
  });
});
