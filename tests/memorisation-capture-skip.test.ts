import { beforeEach, describe, expect, it, mock } from "bun:test";

// Automatic capture skips a turn in which the agent saved a memorisation, so the
// snapshot reaches an agent only through `recall`. This file covers the shared
// pipeline (`captureConversation`) and what each host reader hands to it: the
// OpenCode live reader (V1 and V2 message shapes), the Pi reader and the Claude
// Code transcript reader. The host routes have their own tests next to their
// existing capture tests.

const logged: Array<{ message: string; data: unknown }> = [];
let addCalls = 0;

mock.module("../src/config.js", () => ({
  CONFIG: { autoCaptureEnabled: true, autoCaptureMaxRetries: 1 },
  refreshConfigIfChanged: () => {},
}));
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: unknown) => logged.push({ message, data }),
}));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({ project: { tag: "omms_project_test", displayName: "test" } }),
}));
mock.module("../src/services/client.js", () => ({
  memoryClient: {
    listMemories: async () => ({ success: true, memories: [] }),
    addMemory: async () => ({ success: true, id: `m${++addCalls}` }),
  },
}));
mock.module("../src/services/capture-attempt-store.js", () => ({
  saveCaptureAttempt: async () => {},
}));
const prompts: Array<Record<string, unknown>> = [];
const promptCalls: string[] = [];
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    getUncapturedPromptsForSession: async () => prompts.filter((p) => !p.done),
    claimPrompt: async () => true,
    deletePrompt: async (id: string) => promptCalls.push(`delete:${id}`),
    markAsCaptured: async (id: string) => promptCalls.push(`captured:${id}`),
    linkMemoryToPrompt: async () => {},
    recordFailedAttempt: async () => {},
    releaseClaim: async () => true,
  },
}));
mock.module("../src/services/capture-retry-drain.js", () => ({
  queueFailedCapture: async () => false,
  startCaptureRetryDrain: () => {},
  drainCaptureRetries: async () => ({}),
}));

const { captureConversation } = await import("../src/core/capture.js");
const { extractOpenCodeConversation } = await import("../src/adapters/opencode/conversation.js");
const { extractPiConversation } = await import("../src/importer/pi-conversation.js");
const { extractClaudeConversationWindows } = await import("../src/importer/claude-conversation.js");
const { createLegacyClient } = await import("../src/v2/legacy-client.js");
const { workUnitOf } = await import("../src/importer/claude-turn-units.js");
const { performAutoCapture } = await import("../src/services/auto-capture.js");
const { capturePiSettledWorkUnit, createPiCaptureState } =
  await import("../src/adapters/pi/capture.js");

import type { CaptureToolCall } from "../src/core/host.js";

const SAVED = '{"success":true,"id":"ms-ke8zw6","message":"Snapshot saved"}';
const REFUSED = '{"success":false,"error":"mode is required"}';
const MEMORISE_ARGS = { mode: "memorise", topic: "Rollout", next: "widen to 50 percent" };

let summarizeCalls = 0;
const provider = {
  summarize: async () => {
    summarizeCalls++;
    return { summary: "Canary deployed", type: "discussion", tags: [] };
  },
};

function unit(toolCalls: CaptureToolCall[]) {
  return {
    host: "pi" as const,
    hostSessionId: "ses-1",
    sourceType: "live-capture" as const,
    projectDirectory: "/tmp/project",
    userPrompt: "save where we are",
    textResponses: ["Snapshot saved as ms-ke8zw6"],
    toolCalls,
  };
}

function attempts() {
  return logged.filter((entry) => entry.message === "Capture attempt").map((entry) => entry.data);
}

beforeEach(() => {
  prompts.length = 0;
  promptCalls.length = 0;
  logged.length = 0;
  addCalls = 0;
  summarizeCalls = 0;
});

describe("captureConversation and a memorise turn", () => {
  it("skips a turn with a saved memorisation without calling the capture model", async () => {
    const result = await captureConversation(
      unit([{ name: "memory", input: "", memorise: "saved" }]),
      provider
    );
    expect(result).toEqual({ status: "skipped", reason: "memorisation-turn" });
    expect(summarizeCalls).toBe(0);
    expect(addCalls).toBe(0);
  });

  it("logs one skipped record with the reason code and no content", async () => {
    await captureConversation(unit([{ name: "memory", input: "", memorise: "saved" }]), provider);
    expect(attempts()).toEqual([
      expect.objectContaining({ outcome: "skipped", reason: "memorisation-turn", host: "pi" }),
    ]);
    expect(JSON.stringify(logged)).not.toContain("Snapshot saved");
    expect(JSON.stringify(logged)).not.toContain("save where we are");
  });

  it("captures a turn whose memorise call failed", async () => {
    const result = await captureConversation(
      unit([{ name: "memory", input: "", memorise: "failed" }]),
      provider
    );
    expect(result.status).toBe("captured");
    expect(summarizeCalls).toBe(1);
    expect(attempts()).toEqual([expect.objectContaining({ outcome: "saved", reason: null })]);
  });

  it("captures an ordinary turn", async () => {
    const result = await captureConversation(
      unit([{ name: "read", input: "path: a.ts", outcome: "ok" }]),
      provider
    );
    expect(result.status).toBe("captured");
    expect(addCalls).toBe(1);
  });

  it("skips a history-import turn the same way", async () => {
    const result = await captureConversation(
      { ...unit([{ name: "memory", input: "", memorise: "saved" }]), sourceType: "history-import" },
      provider
    );
    expect(result).toEqual({ status: "skipped", reason: "memorisation-turn" });
    expect(summarizeCalls).toBe(0);
  });
});

describe("OpenCode live reader", () => {
  const messages = (part: object) => [
    { info: { id: "u", role: "user" }, parts: [{ type: "text", text: "save where we are" }] },
    { info: { id: "a", role: "assistant" }, parts: [part] },
  ];

  it("marks a V1 tool part whose output reports success as saved", () => {
    const result = extractOpenCodeConversation(
      messages({
        type: "tool",
        tool: "memory",
        state: { status: "completed", input: MEMORISE_ARGS, output: SAVED },
      }),
      "u"
    );
    expect(result?.toolCalls[0]).toMatchObject({ name: "memory", memorise: "saved" });
  });

  it("marks a V1 tool part whose output reports success false as failed", () => {
    const result = extractOpenCodeConversation(
      messages({
        type: "tool",
        tool: "memory",
        state: { status: "completed", input: MEMORISE_ARGS, output: REFUSED },
      }),
      "u"
    );
    expect(result?.toolCalls[0]?.memorise).toBe("failed");
  });

  it("marks an errored tool part as failed and a pending one as unknown", () => {
    const errored = extractOpenCodeConversation(
      messages({
        type: "tool",
        tool: "memory",
        state: { status: "error", input: MEMORISE_ARGS, error: "boom" },
      }),
      "u"
    );
    const running = extractOpenCodeConversation(
      messages({
        type: "tool",
        tool: "memory",
        state: { status: "running", input: MEMORISE_ARGS },
      }),
      "u"
    );
    expect(errored?.toolCalls[0]?.memorise).toBe("failed");
    expect(running?.toolCalls[0]?.memorise).toBe("unknown");
  });

  it("leaves other memory modes and other tools unmarked", () => {
    const recall = extractOpenCodeConversation(
      messages({
        type: "tool",
        tool: "memory",
        state: { status: "completed", input: { mode: "recall", query: "x" }, output: SAVED },
      }),
      "u"
    );
    expect(recall?.toolCalls[0]).not.toHaveProperty("memorise");
  });

  it("reads the key order the model chose: mode last in a long call", () => {
    const result = extractOpenCodeConversation(
      messages({
        type: "tool",
        tool: "memory",
        state: {
          status: "completed",
          input: { content: "x".repeat(300), mode: "memorise" },
          output: SAVED,
        },
      }),
      "u"
    );
    expect(result?.toolCalls[0]?.memorise).toBe("saved");
  });

  it("marks a Bash call to the CLI memorise command", () => {
    const result = extractOpenCodeConversation(
      messages({
        type: "tool",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: 'om-memory-system memory memorise "state of play"' },
          output: SAVED,
        },
      }),
      "u"
    );
    expect(result?.toolCalls[0]?.memorise).toBe("saved");
  });
});

describe("OpenCode V2 route", () => {
  // The V2 plugin API names the tool `name` and keeps the result in `state.content`;
  // the legacy client passes the parts through, so the live reader must read both shapes.
  async function v2Conversation(state: object) {
    const ctx = {
      session: {
        context: async () => [
          { type: "user", id: "u", text: "save where we are" },
          {
            type: "assistant",
            id: "a",
            content: [{ type: "tool", id: "t1", name: "memory", state }],
          },
        ],
      },
    } as any;
    const { data } = await createLegacyClient(ctx).session.messages({ sessionID: "ses-1" });
    return extractOpenCodeConversation(data, "u");
  }

  it("reads the tool name and a saved result", async () => {
    const result = await v2Conversation({
      status: "completed",
      input: MEMORISE_ARGS,
      content: [{ type: "text", text: SAVED }],
      structured: {},
    });
    expect(result?.toolCalls[0]).toMatchObject({ name: "memory", memorise: "saved" });
  });

  it("does not skip a refused memorise call", async () => {
    const result = await v2Conversation({
      status: "completed",
      input: MEMORISE_ARGS,
      content: [{ type: "text", text: REFUSED }],
      structured: {},
    });
    expect(result?.toolCalls[0]?.memorise).toBe("failed");
    const captured = await captureConversation(unit(result!.toolCalls), provider);
    expect(captured.status).toBe("captured");
  });

  it("skips the turn end to end", async () => {
    const result = await v2Conversation({
      status: "completed",
      input: MEMORISE_ARGS,
      content: [{ type: "text", text: SAVED }],
      structured: {},
    });
    const captured = await captureConversation(
      { ...unit(result!.toolCalls), host: "opencode", textResponses: result!.textResponses },
      provider
    );
    expect(captured).toEqual({ status: "skipped", reason: "memorisation-turn" });
    expect(summarizeCalls).toBe(0);
  });
});

describe("Pi reader", () => {
  const entries = (resultText: string, isError = false) => [
    {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: "2026-01-01T10:00:00.000Z",
      message: { role: "user", content: "save where we are" },
    },
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp: "2026-01-01T10:00:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "memory", arguments: MEMORISE_ARGS }],
      },
    },
    {
      type: "message",
      id: "r1",
      parentId: "a1",
      timestamp: "2026-01-01T10:00:02.000Z",
      message: {
        role: "toolResult",
        toolCallId: "c1",
        isError,
        content: [{ type: "text", text: resultText }],
      },
    },
  ];

  it("marks a memorise call saved from its tool result", () => {
    expect(extractPiConversation(entries(SAVED))?.toolCalls[0]?.memorise).toBe("saved");
  });

  it("marks a reply with success false as failed even when Pi reports no error", () => {
    expect(extractPiConversation(entries(REFUSED))?.toolCalls[0]?.memorise).toBe("failed");
  });

  it("marks an isError result as failed", () => {
    expect(extractPiConversation(entries("denied", true))?.toolCalls[0]?.memorise).toBe("failed");
  });
});

describe("Claude Code transcript reader", () => {
  const transcript = (name: string, input: object, resultText: string, isError = false) => [
    {
      type: "user",
      uuid: "u1",
      timestamp: "2026-01-01T10:00:00.000Z",
      cwd: "/p",
      message: { role: "user", content: "save where we are" },
    },
    {
      type: "assistant",
      uuid: "a1",
      timestamp: "2026-01-01T10:00:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name, input }],
      },
    },
    {
      type: "user",
      uuid: "r1",
      timestamp: "2026-01-01T10:00:02.000Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: isError,
            content: [{ type: "text", text: resultText }],
          },
        ],
      },
    },
  ];
  const first = (entries: ReturnType<typeof transcript>) =>
    extractClaudeConversationWindows(entries as never)[0]!;

  it("marks the plugin tool mcp__omms__memory saved from its tool_result", () => {
    const window = first(transcript("mcp__omms__memory", MEMORISE_ARGS, SAVED));
    expect(window.toolCalls[0]?.memorise).toBe("saved");
  });

  it("marks a denied call (is_error) as failed", () => {
    const window = first(transcript("mcp__omms__memory", MEMORISE_ARGS, "memory failed", true));
    expect(window.toolCalls[0]?.memorise).toBe("failed");
  });

  it("marks a Bash om-memory-system memorise call saved", () => {
    const window = first(
      transcript("Bash", { command: "om-memory-system memory memorise --topic Auth" }, SAVED)
    );
    expect(window.toolCalls[0]?.memorise).toBe("saved");
  });

  it("keeps the mark on the cleaned work unit memory capture reads", () => {
    const window = first(transcript("mcp__omms__memory", MEMORISE_ARGS, SAVED));
    expect(workUnitOf("ses-1", window, "/p")?.toolCalls[0]?.memorise).toBe("saved");
  });

  it("leaves an ordinary turn unmarked", () => {
    const window = first(transcript("Read", { file_path: "/p/a.ts" }, "contents"));
    expect(window.toolCalls[0]).not.toHaveProperty("memorise");
  });
});

describe("OpenCode capture route (performAutoCapture)", () => {
  function opencodeHost(toolCalls: CaptureToolCall[]) {
    return {
      host: "opencode" as const,
      isCaptureReady: () => true,
      getConversation: async () => ({
        textResponses: ["Snapshot saved as ms-ke8zw6"],
        toolCalls,
        sourceEntryIds: ["a1"],
      }),
      summarize: provider.summarize,
    };
  }
  const prompt = () =>
    prompts.push({
      id: "p1",
      sessionId: "ses-1",
      messageId: "m1",
      projectPath: "/tmp/project",
      content: "save where we are",
      createdAt: 1,
    });

  it("does not capture a turn with a saved memorisation and clears the prompt", async () => {
    prompt();
    await performAutoCapture(
      opencodeHost([{ name: "memory", input: "", memorise: "saved" }]),
      "ses-1",
      "/tmp/project"
    );
    expect(summarizeCalls).toBe(0);
    expect(addCalls).toBe(0);
    expect(promptCalls).toEqual(["delete:p1"]);
  });

  it("captures a turn whose memorise call failed", async () => {
    prompt();
    await performAutoCapture(
      opencodeHost([{ name: "memory", input: "", memorise: "failed" }]),
      "ses-1",
      "/tmp/project"
    );
    expect(addCalls).toBe(1);
    expect(promptCalls).toEqual(["captured:p1"]);
  });

  it("captures an ordinary turn", async () => {
    prompt();
    await performAutoCapture(
      opencodeHost([{ name: "read", input: "path: a.ts", outcome: "ok" }]),
      "ses-1",
      "/tmp/project"
    );
    expect(addCalls).toBe(1);
  });
});

describe("Pi capture route (capturePiSettledWorkUnit)", () => {
  const entries = (resultText: string) => [
    {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: "2026-01-01T10:00:00.000Z",
      message: { role: "user", content: "save where we are" },
    },
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp: "2026-01-01T10:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "c1", name: "memory", arguments: MEMORISE_ARGS },
          { type: "text", text: "Snapshot saved as ms-ke8zw6" },
        ],
      },
    },
    {
      type: "message",
      id: "r1",
      parentId: "a1",
      timestamp: "2026-01-01T10:00:02.000Z",
      message: {
        role: "toolResult",
        toolCallId: "c1",
        isError: false,
        content: [{ type: "text", text: resultText }],
      },
    },
  ];
  const settle = (resultText: string) =>
    capturePiSettledWorkUnit({
      sessionId: "pi-1",
      directory: "/tmp/project",
      entries: entries(resultText),
      provider,
      state: createPiCaptureState(),
    });

  it("does not capture a turn with a saved memorisation", async () => {
    const result = await settle(SAVED);
    expect(result).toEqual({ status: "skipped", reason: "extractor-skip" });
    expect(summarizeCalls).toBe(0);
    expect(addCalls).toBe(0);
  });

  it("captures a turn whose memorise call was refused", async () => {
    const result = await settle(REFUSED);
    expect(result.status).toBe("captured");
    expect(addCalls).toBe(1);
  });
});
