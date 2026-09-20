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

const extensionUrl = new URL("../src/adapters/pi/extension.js", import.meta.url).href;
const clientUrl = new URL("../src/services/client.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;
const languageUrl = new URL("../src/services/language-detector.js", import.meta.url).href;
const contextServiceUrl = new URL("../src/services/context.js", import.meta.url).href;
const profileManagerUrl = new URL(
  "../src/services/user-profile/user-profile-manager.js",
  import.meta.url
).href;

function runScenario(code: string): any {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-pi-extension-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

const closeCalls = [];
const toolCalls = [];
const registeredTools = [];
const handlers = {};
let searchQueries = [];

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: {
    autoCaptureEnabled: false,
    autoCaptureLanguage: "en",
    chatMessage: { enabled: true, excludeCurrentSession: true },
    showAutoCaptureToasts: false,
    showUserProfileToasts: false,
    showErrorToasts: false,
    memory: { defaultScope: "project" },
    injectProfile: false,
    userProfileAnalysisInterval: 1,
  },
  isConfigured: () => true,
  initConfig: () => {},
}));

mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    warmup: async () => {},
    ensureStorageReady: async () => {},
    searchMemories: async (query) => {
      searchQueries.push(query);
      return {
        success: true,
        results: [
          { id: "mem-1", memory: "Use WAL mode for the queue", similarity: 0.8, metadata: { sessionID: "other-session" } },
        ],
        total: 1,
        timing: 0,
      };
    },
    addMemory: async () => ({ success: true, id: "mem-new" }),
    deleteMemory: async () => ({ success: true }),
    listMemories: async () => ({ success: true, memories: [] }),
    getEmbeddingInitError: () => null,
    close: async () => {
      closeCalls.push(1);
    },
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
    user: { userEmail: "test@example.com", userName: "Test User" },
  }),
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));

mock.module(${JSON.stringify(languageUrl)}, () => ({
  detectLanguage: () => "en",
  getLanguageName: () => "English",
}));

mock.module(${JSON.stringify(contextServiceUrl)}, () => ({
  formatContextForPrompt: async (_userId, memories) =>
    memories.results.length > 0 ? "<memory_context>injected</memory_context>" : "",
}));

const profileCreates = [];
const profileUpdates = [];
mock.module(${JSON.stringify(profileManagerUrl)}, () => ({
  userProfileManager: {
    getActiveProfile: async () => null,
    createProfile: async (userId, displayName, userName, userEmail, data, count) => {
      profileCreates.push({ userId, displayName, data, count });
      return "profile_new";
    },
    mergeProfileData: async (existing, incoming) => ({
      ...existing,
      preferences: [...(existing.preferences ?? []), ...(incoming.preferences ?? [])],
    }),
    updateProfile: async (profileId, data, additional, note) => {
      profileUpdates.push({ profileId, data, additional, note });
      return true;
    },
  },
}));

const { default: opencodeMemPiExtension } = await import(${JSON.stringify(extensionUrl)});

function makeCtx(overrides = {}) {
  return {
    cwd: "/workspace",
    hasUI: true,
    mode: "tui",
    ui: { notify: () => {} },
    sessionManager: {
      getSessionId: () => "pi-session-1",
      getBranch: () => [],
    },
    model: null,
    modelRegistry: null,
    ...overrides,
  };
}

const pi = {
  on: (event, handler) => {
    handlers[event] = handler;
  },
  registerTool: (definition) => {
    registeredTools.push(definition);
  },
};

opencodeMemPiExtension(pi);

let captured;

${code}

console.log("RESULT:" + JSON.stringify({ registeredTools, toolCalls, closeCalls, searchQueries, profileCreates, profileUpdates, captured: typeof captured !== "undefined" ? captured : null }));
`;

  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: dir });
  const stdout = proc.stdout.toString();
  const match = stdout.match(/RESULT:(.*)$/m);
  if (!match) {
    throw new Error(`scenario produced no result: ${stdout}\n${proc.stderr.toString()}`);
  }
  return JSON.parse(match[1]);
}

describe("Pi extension entry point", () => {
  it("registers the memory tool over shared operations with host=pi context", async () => {
    const output = runScenario(`
captured = registeredTools[0].name;
const execute = registeredTools[0].execute;
const result = await execute("call-1", { mode: "add", content: "marker" }, undefined, undefined, makeCtx());
toolCalls.push(JSON.parse(result.content[0].text));
`);

    expect(output.captured).toBe("memory");
    expect(output.registeredTools.length).toBe(1);
    expect(output.toolCalls[0].success).toBe(true);
  });

  it("injects retrieval as a system-prompt section, never a user message", async () => {
    const output = runScenario(`
const before = await handlers["before_agent_start"](
  { prompt: "how do we run the queue?", systemPrompt: "BASE PROMPT" },
  makeCtx()
);
captured = before;
`);

    expect(output.captured.systemPrompt).toContain("BASE PROMPT");
    expect(output.captured.systemPrompt).toContain("<opencode-mem-retrieval>");
    expect(output.captured.systemPrompt).toContain("<memory_context>injected</memory_context>");
    expect(output.captured).not.toHaveProperty("message");
    expect(output.searchQueries).toEqual(["how do we run the queue?"]);
  });

  it("returns nothing when no relevant memory is found", async () => {
    const output = runScenario(`
searchQueries = [];
const before = await handlers["before_agent_start"](
  { prompt: "", systemPrompt: "BASE PROMPT" },
  makeCtx()
);
captured = before;
`);

    expect(output.captured).toBeNull();
  });

  it("cleans up idempotently across repeated shutdown events", async () => {
    const output = runScenario(`
await handlers["session_shutdown"]({}, makeCtx());
await handlers["session_shutdown"]({}, makeCtx());
await handlers["session_shutdown"]({}, makeCtx());
captured = closeCalls.length;
`);

    expect(output.captured).toBeGreaterThan(0);
    expect(output.closeCalls.length).toBe(3);
    expect(output.closeCalls.length).toBe(output.captured);
  });

  it("runs profile learning at the configured interval after settled prompts", async () => {
    const output = runScenario(`
const validProfile = JSON.stringify({
  preferences: [{ category: "style", description: "prefers Bun", confidence: 0.8, evidence: ["p1"] }],
  patterns: [],
  workflows: [],
});
const ctx = makeCtx({
  model: { provider: "test", id: "model-x" },
  modelRegistry: {
    find: () => null,
    complete: async () => ({
      content: [{ type: "text", text: validProfile }],
      stopReason: "stop",
    }),
  },
  sessionManager: {
    getSessionId: () => "pi-session-1",
    getBranch: () => [
      { type: "message", id: "u-1", parentId: null, timestamp: "2026-01-01T10:00:00.000Z", message: { role: "user", content: "please use bun for installs" } },
    ],
  },
});
await handlers["agent_settled"]({}, ctx);
captured = profileCreates.length;
`);

    // userProfileAnalysisInterval is 1 in this scenario's mocked CONFIG
    expect(output.captured).toBe(1);
    expect(output.profileCreates.length).toBe(1);
    expect(output.profileCreates[0].userId).toBe("test@example.com");
    expect(output.profileCreates[0].count).toBe(1);
    expect(output.profileCreates[0].data.preferences[0].description).toBe("prefers Bun");
  });

  it("skips settled capture when auto-capture is disabled", async () => {
    const output = runScenario(`
const settled = await handlers["agent_settled"]({}, makeCtx());
captured = settled ?? "no-throw";
`);

    // autoCaptureEnabled is false in this scenario; handler must not throw
    expect(output.captured).toBe("no-throw");
    expect(output.toolCalls.length).toBe(0);
  });
});
