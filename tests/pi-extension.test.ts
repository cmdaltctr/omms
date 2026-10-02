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
const backfillUrl = new URL("../src/importer/auto-backfill.js", import.meta.url).href;
const autostartUrl = new URL("../src/services/web-autostart.js", import.meta.url).href;
const ensureUrl = new URL("../src/services/web-ensure.js", import.meta.url).href;
const handoffUrl = new URL("../src/services/runtime-handoff.js", import.meta.url).href;
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
const statusCalls = [];
const toolCalls = [];
const registeredTools = [];
const registeredCommands = [];
const handlers = {};
let searchQueries = [];
let searchError = false;
let warmupError = false;

const stubConfig = {
    autoCaptureEnabled: false,
    autoCaptureLanguage: "en",
    chatMessage: { enabled: true, excludeCurrentSession: true },
    showAutoCaptureToasts: false,
    showUserProfileToasts: false,
    showErrorToasts: false,
    memory: { defaultScope: "project" },
    injectProfile: false,
    userProfileAnalysisInterval: 1,
};
mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: stubConfig,
  isConfigured: () => true,
  initConfig: () => {},
  initConfigWithLegacyMigration: () => {},
  refreshConfigIfChanged: () => {},
}));

mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    warmup: async () => {
      if (warmupError) throw new Error("warmup failed");
    },
    ensureStorageReady: async () => {},
    searchMemories: async (query) => {
      if (searchError) throw new Error("search failed");
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

const logCalls = [];
mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: (message) => logCalls.push(message) }));
const autostartCalls = [];
let autostartFails = false;
mock.module(${JSON.stringify(autostartUrl)}, () => ({
  reconcileWebAutostart: () => {
    autostartCalls.push(1);
    if (autostartFails) throw new Error("login item failed");
  },
}));

const registerCalls = [];
let registerFails = false;
let replaceOlderFails = false;
mock.module(${JSON.stringify(handoffUrl)}, () => ({
  registerOwnCopy: () => {
    registerCalls.push(1);
    if (registerFails) throw new Error("record failed");
    return "written";
  },
  hostReplaceOlder: async () => {
    if (replaceOlderFails) throw new Error("no token");
    return { version: "4.3.2", headers: { "x-omms-token": "local" } };
  },
}));

const ensureCalls = [];
mock.module(${JSON.stringify(ensureUrl)}, () => ({
  // Never settles: a session start must not wait for the web app.
  ensureWebApp: (options) => {
    ensureCalls.push(options);
    return new Promise(() => {});
  },
}));

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
const backfillCalls = [];
let holdBackfill = false;
let releaseBackfill;
mock.module(${JSON.stringify(backfillUrl)}, () => ({
  scheduleAutoBackfill: async (input) => {
    backfillCalls.push(input);
    if (holdBackfill) await new Promise((resolve) => {
      releaseBackfill = resolve;
    });
  },
}));
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

const { default: ommsPiExtension } = await import(${JSON.stringify(extensionUrl)});

function makeCtx(overrides = {}) {
  return {
    cwd: "/workspace",
    hasUI: true,
    mode: "tui",
    ui: {
      notify: () => {},
      setStatus: (key, value) => statusCalls.push([key, value ?? null]),
    },
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
  registerCommand: (name, options) => {
    registeredCommands.push({ name, options });
  },
};

ommsPiExtension(pi);

let captured;

// Background imports can finish after a busy runner's first timer tick.
async function waitFor(condition, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Scenario condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

${code}

console.log("RESULT:" + JSON.stringify({ registeredTools, registeredCommands, toolCalls, closeCalls, statusCalls, searchQueries, profileCreates, profileUpdates, captured: typeof captured !== "undefined" ? captured : null }));
`;

  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: dir, timeout: 3_000 });
  const stdout = proc.stdout.toString();
  const match = stdout.match(/RESULT:(.*)$/m);
  if (!match) {
    throw new Error(`scenario produced no result: ${stdout}\n${proc.stderr.toString()}`);
  }
  return JSON.parse(match[1]);
}

describe("Pi extension entry point", () => {
  it("bounds a scenario wait when the background call never arrives", () => {
    const output = runScenario(`
try {
  await waitFor(() => false, 25);
  captured = "unexpected completion";
} catch (error) {
  captured = error.message;
}
    `);
    expect(output.captured).toBe("Scenario condition did not become true");
  });

  it("reconciles the login item and logs failures without stopping Pi", () => {
    const output = runScenario(`
stubConfig.webServerAutoStart = true;
stubConfig.webServerEnabled = true;
delete process.env.OMMS_DISABLE_WEB_AUTOSTART;
autostartFails = true;
await handlers["session_start"]({}, makeCtx());
await waitFor(() => autostartCalls.length === 1 && logCalls.some((line) => line.includes("login item")));
captured = { calls: autostartCalls.length, logged: logCalls.some((line) => line.includes("login item")) };
    `);
    expect(output.captured).toEqual({ calls: 1, logged: true });
  });

  it("records its copy at session start, whatever the web app settings are", () => {
    const output = runScenario(`
delete stubConfig.webServerAutoStart;
stubConfig.webServerEnabled = false;
process.env.OMMS_DISABLE_WEB_AUTOSTART = "1";
await handlers["session_start"]({}, makeCtx());
await waitFor(() => registerCalls.length === 1);
captured = { calls: registerCalls.length };
    `);
    expect(output.captured).toEqual({ calls: 1 });
  });

  it("logs a record failure and still starts the Pi session", () => {
    const output = runScenario(`
registerFails = true;
await handlers["session_start"]({}, makeCtx());
await waitFor(() => logCalls.some((line) => line.includes("runtime record")));
captured = { calls: registerCalls.length, logged: logCalls.some((line) => line.includes("runtime record")) };
    `);
    expect(output.captured).toEqual({ calls: 1, logged: true });
  });

  it("starts the shared web app once at session start without waiting for it", () => {
    const output = runScenario(`
stubConfig.webServerAutoStart = true;
stubConfig.webServerEnabled = true;
stubConfig.webServerHost = "127.0.0.1";
stubConfig.webServerPort = 4747;
delete process.env.OMMS_DISABLE_WEB_AUTOSTART;
await handlers["session_start"]({}, makeCtx());
await waitFor(() => ensureCalls.length === 1);
captured = { calls: ensureCalls.length, options: ensureCalls[0] };
    `);
    expect(output.captured).toEqual({
      calls: 1,
      options: {
        settings: { enabled: true, baseUrl: "http://127.0.0.1:4747" },
        budgetMs: 0,
        wait: false,
        replaceOlder: { version: "4.3.2", headers: { "x-omms-token": "local" } },
      },
    });
  });

  it("still starts the web app, without replacing an older one, when the token step fails", () => {
    const output = runScenario(`
stubConfig.webServerEnabled = true;
stubConfig.webServerHost = "127.0.0.1";
stubConfig.webServerPort = 4747;
delete process.env.OMMS_DISABLE_WEB_AUTOSTART;
replaceOlderFails = true;
await handlers["session_start"]({}, makeCtx());
await waitFor(() => ensureCalls.length === 1);
captured = { replaceOlder: "replaceOlder" in ensureCalls[0] };
    `);
    expect(output.captured).toEqual({ replaceOlder: false });
  });

  it("starts the shared web app even when webServerAutoStart is unset", () => {
    const output = runScenario(`
delete stubConfig.webServerAutoStart;
stubConfig.webServerEnabled = true;
stubConfig.webServerHost = "127.0.0.1";
stubConfig.webServerPort = 4747;
delete process.env.OMMS_DISABLE_WEB_AUTOSTART;
await handlers["session_start"]({}, makeCtx());
await waitFor(() => ensureCalls.length === 1);
captured = { ensure: ensureCalls.length, loginItem: autostartCalls.length };
    `);
    // The login item stays tied to webServerAutoStart. The web app check does not.
    expect(output.captured).toEqual({ ensure: 1, loginItem: 0 });
  });

  it("does not start the web app when web autostart is disabled for tests", () => {
    const output = runScenario(`
stubConfig.webServerAutoStart = true;
stubConfig.webServerEnabled = true;
process.env.OMMS_DISABLE_WEB_AUTOSTART = "1";
await handlers["session_start"]({}, makeCtx());
await new Promise((resolve) => setTimeout(resolve, 10));
captured = { calls: ensureCalls.length };
    `);
    expect(output.captured).toEqual({ calls: 0 });
  });

  it("schedules backfill once and resolves the configured Pi model", () => {
    const output = runScenario(`
stubConfig.autoBackfill = true;
stubConfig.piBackfillModel = "zai/glm-5-turbo";
delete process.env.OMMS_DISABLE_AUTO_BACKFILL;
const ctx = makeCtx({ model: { provider: "zai", id: "session" },
  modelRegistry: { find: (provider, id) => ({ provider, id }),
    complete: async () => ({ content: [{ type: "text", text: "done" }] }) } });
await handlers["session_start"]({}, ctx);
await handlers["session_start"]({}, ctx);
await (globalThis[Symbol.for("omms.pi.backfill.scheduled")]?.promise ?? globalThis[Symbol.for("omms.pi.backfill.scheduled")]);
const resolved = await backfillCalls[0]?.resolveModels();
captured = { count: backfillCalls.length, model: resolved?.model };
    `);
    expect(output.captured).toEqual({ count: 1, model: "zai/glm-5-turbo" });
  });
  it("uses the live-model rule for an inherited Pi backfill model", () => {
    const output = runScenario(`
stubConfig.autoBackfill = true;
stubConfig.piBackfillModel = "inherit";
stubConfig.piProvider = "zai";
stubConfig.piModel = "configured";
delete process.env.OMMS_DISABLE_AUTO_BACKFILL;
const ctx = makeCtx({ model: { provider: "zai", id: "session" },
  modelRegistry: { find: (provider, id) => ({ provider, id }),
    complete: async () => ({ content: [{ type: "text", text: "done" }] }) } });
await handlers["session_start"]({}, ctx);
await (globalThis[Symbol.for("omms.pi.backfill.scheduled")]?.promise ?? globalThis[Symbol.for("omms.pi.backfill.scheduled")]);
captured = (await backfillCalls[0]?.resolveModels()).model;
    `);
    expect(output.captured).toBe("zai/configured");
  });

  it("aborts and awaits backfill before closing the store, then allows a new session", () => {
    const output = runScenario(`
stubConfig.autoBackfill = true;
delete process.env.OMMS_DISABLE_AUTO_BACKFILL;
holdBackfill = true;
const ctx = makeCtx();
await handlers["session_start"]({}, ctx);
await waitFor(() => backfillCalls.length === 1);
const closing = handlers["session_shutdown"]({}, ctx);
await waitFor(() => backfillCalls[0]?.signal?.aborted);
const closedBeforeBackfillSettled = closeCalls.length;
const signalled = backfillCalls[0]?.signal?.aborted ?? false;
releaseBackfill?.();
await closing;
holdBackfill = false;
await handlers["session_start"]({}, ctx);
await waitFor(() => backfillCalls.length === 2);
captured = { closedBeforeBackfillSettled, signalled, scheduled: backfillCalls.length };
    `);
    expect(output.captured).toEqual({
      closedBeforeBackfillSettled: 0,
      signalled: true,
      scheduled: 2,
    });
  });

  it("registers the history import command alongside the memory tool", async () => {
    const output = runScenario(`
captured = registeredCommands.map((c) => c.name);
`);

    expect(output.captured).toEqual(["memory-import-pi-history"]);
  });

  it("removes expired trace files at session start even with tracing off", async () => {
    const output = runScenario(`
const fs = await import("node:fs");
const path = await import("node:path");
const os = await import("node:os");
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "omms-pi-traces-"));
process.env.OMMS_LOG_FILE = path.join(logDir, "omms.log");
const traces = path.join(logDir, "traces");
fs.mkdirSync(traces, { recursive: true });
fs.writeFileSync(path.join(traces, "capture-2000-01-01.jsonl"), "{}\\n");
await handlers["session_start"]({}, makeCtx());
captured = fs.readdirSync(traces);
fs.rmSync(logDir, { recursive: true, force: true });
`);

    expect(output.captured).toEqual([]);
  });

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

  it("shows warming then connected when the Pi session starts", async () => {
    const output = runScenario(`
await handlers["session_start"]({}, makeCtx());
await new Promise((resolve) => setTimeout(resolve, 0));
captured = statusCalls;
`);

    expect(output.captured).toEqual([
      ["omms", "omms:warming"],
      ["omms", "omms:connected"],
    ]);
  });

  it("shows recalling then connected during retrieval", async () => {
    const output = runScenario(`
await handlers["before_agent_start"](
  { prompt: "how do we run the queue?", systemPrompt: "BASE PROMPT" },
  makeCtx()
);
captured = statusCalls;
`);

    expect(output.captured).toEqual([
      ["omms", "omms:recalling"],
      ["omms", "omms:connected"],
    ]);
  });

  it("shows an error when retrieval fails", async () => {
    const output = runScenario(`
searchError = true;
await handlers["before_agent_start"](
  { prompt: "how do we run the queue?", systemPrompt: "BASE PROMPT" },
  makeCtx()
);
captured = statusCalls;
`);

    expect(output.captured).toEqual([
      ["omms", "omms:recalling"],
      ["omms", "omms:error"],
    ]);
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
    expect(output.captured.systemPrompt).toContain("<omms-retrieval>");
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

  it("shows capturing then connected when settled work is processed", async () => {
    const output = runScenario(`
await handlers["agent_settled"]({}, makeCtx());
captured = statusCalls;
`);

    expect(output.captured).toEqual([
      ["omms", "omms:capturing"],
      ["omms", "omms:connected"],
    ]);
  });

  it("clears the OMMS status during shutdown", async () => {
    const output = runScenario(`
await handlers["session_shutdown"]({}, makeCtx());
captured = statusCalls;
`);

    expect(output.captured).toEqual([["omms", null]]);
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
