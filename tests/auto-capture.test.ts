import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const autoCaptureUrl = new URL("../src/services/auto-capture.js", import.meta.url).href;
const clientUrl = new URL("../src/services/client.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const promptManagerUrl = new URL(
  "../src/services/user-prompt/user-prompt-manager.js",
  import.meta.url
).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;
const languageUrl = new URL("../src/services/language-detector.js", import.meta.url).href;
const retryDrainUrl = new URL("../src/services/capture-retry-drain.js", import.meta.url).href;
const opencodeProviderLoaderUrl = new URL(
  "../src/adapters/opencode/opencode-provider-loader.js",
  import.meta.url
).href;

function runScenario() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-auto-capture-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

const prompts = [
  {
    id: "prompt-1",
    sessionId: "session-1",
    messageId: "msg-1",
    projectPath: "/workspace",
    content: "First request",
    createdAt: 1,
    captured: false,
    claimed: false,
    capture_attempts: 0,
  },
  {
    id: "prompt-2",
    sessionId: "session-1",
    messageId: "msg-2",
    projectPath: "/workspace",
    content: "Second request",
    createdAt: 2,
    captured: false,
    claimed: false,
    capture_attempts: 0,
  },
];
const addCalls = [];
const summaryPrompts = [];

function pendingForSession(sessionId) {
  return prompts
    .filter((prompt) => prompt.sessionId === sessionId && !prompt.captured && !prompt.claimed)
    .sort((a, b) => a.createdAt - b.createdAt);
}

mock.module(${JSON.stringify(configUrl)}, () => ({
  refreshConfigIfChanged: () => {},
  CONFIG: {
    autoCaptureMaxRetries: 1,
    autoCaptureProviderStatus: { ready: true, mode: "opencode", issues: [] },
    autoCaptureLanguage: "en",
    opencodeProvider: "openai",
    opencodeModel: "gpt-test",
    showAutoCaptureToasts: false,
    showErrorToasts: false,
  },
}));

mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    listMemories: async () => ({ success: true, memories: [] }),
    addMemory: async (content, _tag, metadata) => {
      addCalls.push({ content, metadata });
      return { success: true, id: \`mem-\${addCalls.length}\` };
    },
    close() {},
  },
}));

mock.module(${JSON.stringify(tagsUrl)}, () => ({
  getTags: () => ({
    project: {
      tag: "opencode_project_test",
      displayName: "Test Project",
      userName: "Test User",
      userEmail: "test@example.com",
      projectPath: "/workspace",
      projectName: "workspace",
      gitRepoUrl: undefined,
    },
  }),
}));

mock.module(${JSON.stringify(promptManagerUrl)}, () => ({
  userPromptManager: {
    getLastUncapturedPrompt(sessionId) {
      return [...pendingForSession(sessionId)].pop() ?? null;
    },
    getUncapturedPromptsForSession(sessionId) {
      return pendingForSession(sessionId);
    },
    claimPrompt(id) {
      const prompt = prompts.find((item) => item.id === id);
      if (!prompt || prompt.captured || prompt.claimed) return false;
      prompt.claimed = true;
      return true;
    },
    recordFailedAttempt(id) {
      const prompt = prompts.find((item) => item.id === id);
      if (prompt) prompt.capture_attempts += 1;
    },
    releaseClaim(id) {
      const prompt = prompts.find((item) => item.id === id);
      if (!prompt || !prompt.claimed || prompt.captured) return false;
      prompt.claimed = false;
      return true;
    },
    linkMemoryToPrompt(id, memoryId) {
      const prompt = prompts.find((item) => item.id === id);
      if (prompt) prompt.linkedMemoryId = memoryId;
    },
    markAsCaptured(id) {
      const prompt = prompts.find((item) => item.id === id);
      if (prompt) {
        prompt.captured = true;
        prompt.claimed = false;
      }
    },
    deletePrompt(id) {
      const prompt = prompts.find((item) => item.id === id);
      if (prompt) {
        prompt.captured = true;
        prompt.claimed = false;
        prompt.deleted = true;
      }
    },
  },
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));
mock.module(${JSON.stringify(languageUrl)}, () => ({
  detectLanguage: () => "en",
  getLanguageName: () => "English",
}));
mock.module(${JSON.stringify(opencodeProviderLoaderUrl)}, () => ({
  loadOpencodeProvider: async () => ({
    isProviderConnected: () => true,
    getV2Client: () => ({}),
    generateStructuredOutput: async ({ userPrompt }) => {
      summaryPrompts.push(userPrompt);
      return {
        summary: userPrompt.includes("First request") ? "summary-first" : "summary-second",
        type: "discussion",
        tags: [],
      };
    },
  }),
}));

const { performAutoCapture } = await import(${JSON.stringify(autoCaptureUrl)});
const conversations = {
  "msg-1": {
    textResponses: ["First response"],
    toolCalls: [],
    sourceEntryIds: ["assistant-1"],
  },
  "msg-2": {
    textResponses: ["Second response"],
    toolCalls: [],
    sourceEntryIds: ["assistant-2"],
  },
};

await performAutoCapture(
  {
    host: "opencode",
    isCaptureReady: () => true,
    getConversation: async (_sessionId, promptMessageId) => conversations[promptMessageId] ?? null,
    summarize: async ({ context }) => {
      summaryPrompts.push(context);
      return {
        summary: context.includes("First request") ? "summary-first" : "summary-second",
        type: "discussion",
        tags: [],
      };
    },
    notify: async () => {},
  },
  "session-1",
  "/workspace"
);

console.log(
  JSON.stringify({
    addPromptIds: addCalls.map((call) => call.metadata.promptId),
    summaries: addCalls.map((call) => call.content),
    summaryPrompts,
    hosts: addCalls.map((call) => call.metadata.host),
    sourceTypes: addCalls.map((call) => call.metadata.sourceType),
    hostSessionIds: addCalls.map((call) => call.metadata.hostSessionId),
  })
);
`;

  writeFileSync(scriptPath, script);

  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();

  return {
    exitCode: result.exitCode,
    stdout,
    stderr,
    parsed: stdout ? JSON.parse(stdout) : null,
  };
}

function runProviderFailureScenario() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-auto-capture-error-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

const toasts = [];
let failedAttempts = 0;
let released = false;

mock.module(${JSON.stringify(configUrl)}, () => ({
  refreshConfigIfChanged: () => {},
  CONFIG: {
    autoCaptureMaxRetries: 1,
    autoCaptureProviderStatus: { ready: true, mode: "opencode", issues: [] },
    autoCaptureLanguage: "en",
    opencodeProvider: "opencode-go",
    opencodeModel: "deepseek-v4-flash",
    showAutoCaptureToasts: false,
    showErrorToasts: true,
  },
}));

mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    listMemories: async () => ({ success: true, memories: [] }),
    addMemory: async () => ({ success: true, id: "unexpected" }),
    close() {},
  },
}));

mock.module(${JSON.stringify(tagsUrl)}, () => ({
  getTags: () => ({
    project: {
      tag: "opencode_project_test",
      displayName: "Test Project",
      projectPath: "/workspace",
    },
  }),
}));

mock.module(${JSON.stringify(promptManagerUrl)}, () => ({
  userPromptManager: {
    getUncapturedPromptsForSession: async () => [{
      id: "prompt-error",
      sessionId: "session-error",
      messageId: "msg-error",
      projectPath: "/workspace",
      content: "Implement the requested change",
      createdAt: 1,
      captured: false,
      capture_attempts: 0,
    }],
    claimPrompt: async () => true,
    recordFailedAttempt: async () => { failedAttempts += 1; },
    releaseClaim: async () => { released = true; return true; },
  },
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));
mock.module(${JSON.stringify(languageUrl)}, () => ({
  detectLanguage: () => "en",
  getLanguageName: () => "English",
}));
mock.module(${JSON.stringify(opencodeProviderLoaderUrl)}, () => ({
  loadOpencodeProvider: async () => ({
    isProviderConnected: () => true,
    getV2Client: () => ({}),
    generateStructuredOutput: async () => {
      throw new Error(
        "omms: opencode reported APIError: Thinking mode does not support this tool_choice"
      );
    },
  }),
}));

const { performAutoCapture } = await import(${JSON.stringify(autoCaptureUrl)});
await performAutoCapture(
  {
    host: "opencode",
    isCaptureReady: () => true,
    getConversation: async () => ({
      textResponses: ["Implemented it"],
      toolCalls: [],
      sourceEntryIds: ["assistant-error"],
    }),
    summarize: async () => {
      throw new Error(
        "omms: opencode reported APIError: Thinking mode does not support this tool_choice"
      );
    },
    notify: async (notification) => {
      toasts.push({ body: notification });
    },
  },
  "session-error",
  "/workspace"
);

console.log(JSON.stringify({ toasts, failedAttempts, released }));
`;

  writeFileSync(scriptPath, script);

  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();

  return {
    exitCode: result.exitCode,
    stderr,
    parsed: stdout ? JSON.parse(stdout) : null,
  };
}

function runRetryQueueScenario() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-auto-capture-retry-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

const prompts = {};
for (const id of ["prompt-fail", "prompt-ok", "prompt-retried", "prompt-retry-skip"]) {
  prompts[id] = { id, captured: false, deleted: false, linkedMemoryId: null };
}
const queuedRetries = [];
const drainStarts = [];
const refreshed = [];
const drained = [];

mock.module(${JSON.stringify(configUrl)}, () => ({
  refreshConfigIfChanged: (directory) => refreshed.push(directory),
  CONFIG: {
    autoCaptureMaxRetries: 1,
    autoCaptureProviderStatus: { ready: true, mode: "opencode", issues: [] },
    showAutoCaptureToasts: false,
    showErrorToasts: false,
  },
}));
mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    listMemories: async () => ({ success: true, memories: [] }),
    addMemory: async () => ({ success: true, id: "mem-live" }),
    close() {},
  },
}));
mock.module(${JSON.stringify(tagsUrl)}, () => ({
  getTags: () => ({ project: { tag: "opencode_project_test", displayName: "Test" } }),
}));
mock.module(${JSON.stringify(promptManagerUrl)}, () => ({
  userPromptManager: {
    getUncapturedPromptsForSession: async () => [
      { id: "prompt-fail", messageId: "msg-fail", content: "fail", capture_attempts: 0 },
      { id: "prompt-ok", messageId: "msg-ok", content: "ok", capture_attempts: 0 },
    ],
    claimPrompt: async () => true,
    recordFailedAttempt: async () => {},
    releaseClaim: async () => true,
    linkMemoryToPrompt: async (id, memoryId) => { prompts[id].linkedMemoryId = memoryId; },
    markAsCaptured: async (id) => { prompts[id].captured = true; },
    deletePrompt: async (id) => { prompts[id].deleted = true; },
  },
}));
mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));
mock.module(${JSON.stringify(retryDrainUrl)}, () => ({
  queueFailedCapture: async (unit, error) => {
    queuedRetries.push({ promptId: unit.promptId, host: unit.host, error: error.message });
    return true;
  },
  startCaptureRetryDrain: (host) => drainStarts.push(host),
  drainCaptureRetries: async (options) => {
    drained.push({ host: options.host, refreshedFirst: refreshed.includes("/workspace") });
    return {};
  },
}));

const { performAutoCapture, settleOpencodeRetriedPrompt, drainOpencodeCaptureRetries } = await import(
  ${JSON.stringify(autoCaptureUrl)}
);
await performAutoCapture(
  {
    host: "opencode",
    isCaptureReady: () => true,
    getConversation: async () => ({ textResponses: ["done"], toolCalls: [] }),
    summarize: async ({ userPrompt }) => {
      if (userPrompt === "fail") throw new Error("ECONNREFUSED");
      return { summary: "saved", type: "discussion", tags: [] };
    },
  },
  "session-1",
  "/workspace"
);

const unit = (promptId) => ({ host: "opencode", promptId });
await settleOpencodeRetriedPrompt(unit("prompt-retried"), { status: "captured", memoryId: "mem-retry" });
await settleOpencodeRetriedPrompt(unit("prompt-retry-skip"), { status: "skipped" });

refreshed.length = 0;
await drainOpencodeCaptureRetries({ isCaptureReady: () => true }, "/workspace");

console.log(JSON.stringify({ queuedRetries, drainStarts, prompts, drained }));
`;

  writeFileSync(scriptPath, script);
  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();
  return { exitCode: result.exitCode, stderr, parsed: stdout ? JSON.parse(stdout) : null };
}

describe("auto-capture idle processing", () => {
  it("captures all uncaptured prompts in a session in chronological response windows", () => {
    const result = runScenario();

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed?.addPromptIds).toEqual(["prompt-1", "prompt-2"]);
    expect(result.parsed?.summaries).toEqual(["summary-first", "summary-second"]);
    expect(result.parsed?.summaryPrompts[0]).toContain("First response");
    expect(result.parsed?.summaryPrompts[0]).not.toContain("Second response");
    expect(result.parsed?.summaryPrompts[1]).toContain("Second response");
    expect(result.parsed?.hosts).toEqual(["opencode", "opencode"]);
    expect(result.parsed?.sourceTypes).toEqual(["live-capture", "live-capture"]);
    expect(result.parsed?.hostSessionIds).toEqual(["session-1", "session-1"]);
  });

  it("preserves the opencode provider error when no manual fallback is configured", () => {
    const result = runProviderFailureScenario();

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed?.failedAttempts).toBe(1);
    expect(result.parsed?.released).toBe(true);
    expect(result.parsed?.toasts).toHaveLength(1);
    const message = result.parsed?.toasts[0]?.body?.message ?? "";
    expect(message).toContain("Thinking mode does not support");
    expect(message).not.toContain("External API not configured");
  });

  it("queues a turn after the last quick retry fails and starts a retry pass after a save", () => {
    const result = runRetryQueueScenario();

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.parsed?.queuedRetries).toEqual([
      {
        promptId: "prompt-fail",
        host: "opencode",
        error: "Summary generation failed: ECONNREFUSED",
      },
    ]);
    expect(result.parsed?.drainStarts).toEqual(["opencode"]);
  });

  it("marks a retried prompt captured and linked, and deletes a skipped one", () => {
    const result = runRetryQueueScenario();

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.parsed?.prompts["prompt-retried"]).toMatchObject({
      captured: true,
      linkedMemoryId: "mem-retry",
    });
    expect(result.parsed?.prompts["prompt-retry-skip"].deleted).toBe(true);
  });

  it("reloads a changed config file before a retry pass", () => {
    const result = runRetryQueueScenario();

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.parsed?.drained).toEqual([{ host: "opencode", refreshedFirst: true }]);
  });
});
