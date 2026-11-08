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
const selfUpdateUrl = new URL("../src/adapters/pi/self-update.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;
const languageUrl = new URL("../src/services/language-detector.js", import.meta.url).href;
const contextServiceUrl = new URL("../src/services/context.js", import.meta.url).href;
const skillOperationsUrl = new URL("../src/core/skill-operations.js", import.meta.url).href;
const skillDepsUrl = new URL("../src/services/skill-learning/operations-deps.js", import.meta.url)
  .href;
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
const widgetCalls = [];
let formattedContext = null;
let formatFn = null;
let resultsFor = null;
let sessionMemories = [];
const sessionSearches = [];

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
        results: resultsFor ? resultsFor(query) : [
          { id: "mem-1", memory: "Use WAL mode for the queue", similarity: 0.8, metadata: { sessionID: "other-session" } },
        ],
        total: 1,
        timing: 0,
      };
    },
    searchMemoriesBySessionID: async (sessionId, tag, limit) => {
      sessionSearches.push({ sessionId, tag, limit });
      return { success: true, results: sessionMemories, total: sessionMemories.length, timing: 0 };
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
const replaceSettings = [];
mock.module(${JSON.stringify(handoffUrl)}, () => ({
  registerOwnCopy: () => {
    registerCalls.push(1);
    if (registerFails) throw new Error("record failed");
    return "written";
  },
  hostReplaceOlder: async (settings) => {
    replaceSettings.push(settings);
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
    memories.results.length > 0
      ? (formatFn ? formatFn(memories.results) : (formattedContext ?? "<memory_context>injected</memory_context>"))
      : "",
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

// The real module asks npm and may start Pi's update command. A scenario drives this fake instead.
const selfUpdateCalls = [];
let selfUpdateSuffix = "";
let selfUpdateChanged = () => {};
mock.module(${JSON.stringify(selfUpdateUrl)}, () => ({
  createPiSelfUpdate: () => ({
    start: (session, onChange) => {
      selfUpdateCalls.push(["start", session.hasUI]);
      selfUpdateChanged = onChange;
      // Never settles: a session start must not wait for the update.
      return new Promise(() => {});
    },
    suffix: () => selfUpdateSuffix,
    stop: () => selfUpdateCalls.push(["stop"]),
  }),
}));

const skillOperationCalls = [];
mock.module(${JSON.stringify(skillOperationsUrl)}, () => ({
  runSkillOperation: async (mode, args, deps) => {
    skillOperationCalls.push({ mode, args, deps });
    return { success: true, mode, code: "ok", text: "Skills by use" };
  },
}));
mock.module(${JSON.stringify(skillDepsUrl)}, () => ({
  skillOperationsDeps: (directory, appliedBy) => ({ directory, appliedBy }),
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
      setWidget: (key, content, options) =>
        widgetCalls.push([
          key,
          content ? content({}, { fg: (_colour, text) => text }).render(200) : null,
          options?.placement ?? null,
        ]),
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

function ctxWith(branch = [], sessionId = "pi-session-1", extra = {}) {
  return makeCtx({ sessionManager: { getSessionId: () => sessionId, getBranch: () => branch }, ...extra });
}
const USER_ENTRY = { type: "message", id: "u-0", parentId: null, timestamp: "2026-01-01T10:00:00.000Z", message: { role: "user", content: "an earlier prompt" } };
const sectionsOf = (reply) => (reply && reply.systemPrompt ? reply.systemPrompt.match(/<omms-retrieval>[\\s\\S]*?<\\/omms-retrieval>/g) ?? [] : []);
function useOpeningFixtures() {
  formatFn = (results) => "<memory_context>" + results.map((r) => '<memory id="' + r.id + '" relevance="80%">' + r.memory + "</memory>").join("\\n") + "</memory_context>";
  const promptMemory = { id: "mem-prompt", memory: "Prompt memory", similarity: 0.8, metadata: { sessionID: "other" } };
  const openingMemory = { id: "mem-open", memory: "Opening memory", similarity: 0.8, metadata: { sessionID: "other" } };
  resultsFor = (query) => (query === "project setup" ? [openingMemory, promptMemory] : [promptMemory]);
  sessionMemories = [
    { id: "mem-r1", memory: "Restore one", tags: [], metadata: { host: "pi" } },
    { id: "mem-x", memory: "Other host memory", tags: [], metadata: { host: "opencode" } },
  ];
  stubConfig.openingContext = true;
  stubConfig.openingContextQuery = "project setup";
  stubConfig.subagentMemory = true;
  stubConfig.compaction = { enabled: true, memoryLimit: 7 };
}

${code}

console.log("RESULT:" + JSON.stringify({ sessionSearches, widgetCalls, registeredTools, registeredCommands, toolCalls, closeCalls, statusCalls, searchQueries, profileCreates, profileUpdates, captured: typeof captured !== "undefined" ? captured : null }));
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

  it("gives the browser password settings to the web app replacement", () => {
    const output = runScenario(`
stubConfig.webServerEnabled = true;
stubConfig.webServerHost = "127.0.0.1";
stubConfig.webServerPort = 4747;
stubConfig.webServerAuthPassword = "pw";
stubConfig.webServerAuthUsername = "me";
delete process.env.OMMS_DISABLE_WEB_AUTOSTART;
await handlers["session_start"]({}, makeCtx());
await waitFor(() => ensureCalls.length === 1);
captured = { settings: replaceSettings[0] };
    `);
    expect(output.captured.settings).toMatchObject({
      webServerAuthPassword: "pw",
      webServerAuthUsername: "me",
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

    expect(output.captured).toEqual(["omms-recall", "memory-import-pi-history"]);
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
    expect(output.registeredTools.map((t: any) => t.name)).toEqual(["memory", "skills"]);
    expect(output.toolCalls[0].success).toBe(true);
  });

  it("registers the skills tool over the shared skill operations, applied by the agent", async () => {
    const output = runScenario(`
const skills = registeredTools.find((t) => t.name === "skills");
const result = await skills.execute(
  "call-2",
  { mode: "draft", idea: { name: "deploy", description: "Deploy steps" }, folder: "/skills" },
  undefined,
  undefined,
  makeCtx()
);
captured = {
  description: skills.description,
  modes: skills.parameters.properties.mode.anyOf.map((m) => m.const),
  reply: JSON.parse(result.content[0].text),
  call: skillOperationCalls[0],
};
`);

    expect(output.captured.description).toContain("ranked by use");
    expect(output.captured.description).toContain("only when the user asks");
    expect(output.captured.modes).toEqual([
      "list",
      "ideas",
      "draft",
      "evidence",
      "propose",
      "proposals",
      "show",
      "apply",
      "reject",
      "undo",
      "help",
    ]);
    expect(output.captured.reply).toEqual({
      success: true,
      mode: "draft",
      code: "ok",
      text: "Skills by use",
    });
    expect(output.captured.call).toEqual({
      mode: "draft",
      args: { idea: { name: "deploy", description: "Deploy steps" }, folder: "/skills" },
      deps: { directory: "/workspace", appliedBy: "agent" },
    });
  });

  it("shows warming then connected when the Pi session starts", async () => {
    const output = runScenario(`
await handlers["session_start"]({}, makeCtx());
await new Promise((resolve) => setTimeout(resolve, 0));
captured = statusCalls;
`);

    expect(output.captured).toEqual([
      ["omms", "omms: ⧖"],
      ["omms", "omms: ✔"],
    ]);
  });

  it("starts the self-update at session start without waiting for it", () => {
    const output = runScenario(`
await handlers["session_start"]({}, makeCtx());
captured = selfUpdateCalls;
`);
    expect(output.captured).toEqual([["start", true]]);
  });

  it("starts the self-update with no user interface, and stops it at shutdown", () => {
    const output = runScenario(`
const ctx = makeCtx({ hasUI: false });
await handlers["session_start"]({}, ctx);
await handlers["session_shutdown"]({}, ctx);
captured = selfUpdateCalls;
`);
    expect(output.captured).toEqual([["start", false], ["stop"]]);
  });

  it("keeps the update suffix when the glyph changes to recalling and capturing", () => {
    const output = runScenario(`
selfUpdateSuffix = " · 4.3.0 installed, restart";
stubConfig.autoCaptureEnabled = true;
await handlers["before_agent_start"](
  { prompt: "how do we run the queue?", systemPrompt: "BASE PROMPT" },
  makeCtx()
);
await handlers["agent_settled"]({}, makeCtx());
captured = statusCalls.map((call) => call[1]);
`);
    expect(output.captured.slice(0, 2)).toEqual([
      "omms: ↻ · 4.3.0 installed, restart",
      "omms: ✔ · 4.3.0 installed, restart",
    ]);
    expect(output.captured).toContain("omms: ✎ · 4.3.0 installed, restart");
    expect(
      output.captured.every((label: string) => label.endsWith(" · 4.3.0 installed, restart"))
    ).toBe(true);
  });

  it("refreshes the label with the current glyph when the update suffix changes", () => {
    const output = runScenario(`
await handlers["session_start"]({}, makeCtx());
await new Promise((resolve) => setTimeout(resolve, 0));
selfUpdateSuffix = " · 4.3.0 installed, restart";
selfUpdateChanged();
captured = statusCalls.map((call) => call[1]);
`);
    expect(output.captured).toEqual(["omms: ⧖", "omms: ✔", "omms: ✔ · 4.3.0 installed, restart"]);
  });

  it("does not redraw the label after the session shut down", () => {
    const output = runScenario(`
const ctx = makeCtx();
await handlers["session_start"]({}, ctx);
await new Promise((resolve) => setTimeout(resolve, 0));
await handlers["session_shutdown"]({}, ctx);
selfUpdateSuffix = " · 4.3.0 available";
selfUpdateChanged();
captured = statusCalls.map((call) => call[1]);
`);
    expect(output.captured).toEqual(["omms: ⧖", "omms: ✔", null]);
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
      ["omms", "omms: ↻"],
      ["omms", "omms: ✔"],
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
      ["omms", "omms: ↻"],
      ["omms", "omms: ✘"],
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

  const RECALL_SECTION = [
    "<memory_context>",
    '<memory id="mem-1" relevance="80%">',
    "Use WAL mode for queue",
    "</memory>",
    "</memory_context>",
  ].join("\n");
  const RECALL_ROW = '▸ ● memory [mode=search, query="how do we run the queue?", limit=1]';
  const PROMPT_EVENT = `{ prompt: "how do we run the queue?", systemPrompt: "BASE PROMPT" }`;

  it("draws a recall row and returns the same system prompt with rows on or off", async () => {
    const output = runScenario(`
formattedContext = ${JSON.stringify(RECALL_SECTION)};
const on = await handlers["before_agent_start"](${PROMPT_EVENT}, makeCtx());
const onWidgets = widgetCalls.splice(0);
stubConfig.visibleRecall = false;
const off = await handlers["before_agent_start"](${PROMPT_EVENT}, makeCtx());
const offWidgets = widgetCalls.splice(0);
stubConfig.visibleRecall = true;
await handlers["before_agent_start"](${PROMPT_EVENT}, makeCtx());
captured = { on, off, onWidgets, offWidgets, againWidgets: widgetCalls };
`);

    expect(output.captured.on.systemPrompt).toContain("Use WAL mode for queue");
    expect(output.captured.off.systemPrompt).toBe(output.captured.on.systemPrompt);
    expect(output.captured.onWidgets).toEqual([["omms-recall", [RECALL_ROW], "aboveEditor"]]);
    // A config edit applies from the next prompt: off clears the rows, on draws them again.
    expect(output.captured.offWidgets).toEqual([["omms-recall", null, null]]);
    expect(output.captured.againWidgets).toEqual([
      ["omms-recall", [RECALL_ROW, RECALL_ROW, RECALL_ROW], "aboveEditor"],
    ]);
  });

  it("draws no recall row in RPC mode", async () => {
    const output = runScenario(`
formattedContext = ${JSON.stringify(RECALL_SECTION)};
captured = await handlers["before_agent_start"](${PROMPT_EVENT}, makeCtx({ mode: "rpc" }));
`);

    expect(output.captured.systemPrompt).toContain("Use WAL mode for queue");
    expect(output.widgetCalls).toEqual([]);
  });

  it("toggles the rows with /omms-recall and clears them on session_shutdown", async () => {
    const output = runScenario(`
formattedContext = ${JSON.stringify(RECALL_SECTION)};
await handlers["before_agent_start"](${PROMPT_EVENT}, makeCtx());
const command = registeredCommands.find((entry) => entry.name === "omms-recall");
await command.options.handler("", makeCtx());
const unfolded = widgetCalls.at(-1);
await handlers["session_shutdown"]({}, makeCtx());
captured = { unfolded, afterShutdown: widgetCalls.at(-1) };
`);

    expect(output.captured.unfolded[1][0]).toStartWith("▾ ● memory");
    expect(output.captured.unfolded[1]).toContain("  1. 80% id=mem-1 Use WAL mode for queue");
    expect(output.captured.afterShutdown).toEqual(["omms-recall", null, null]);
  });

  it("shows capturing then connected when settled work is processed", async () => {
    const output = runScenario(`
await handlers["agent_settled"]({}, makeCtx());
captured = statusCalls;
`);

    expect(output.captured).toEqual([
      ["omms", "omms: ✎"],
      ["omms", "omms: ✔"],
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

// Change align-recall-host-parity, tasks 6.1 and 6.2: opening section, restore after
// compaction and resume, child gate, and the rows that report them.
describe("Pi extension opening context and restore", () => {
  const PROMPT_EVENT = `{ prompt: "how do we run the queue?", systemPrompt: "BASE" }`;

  it("adds the prompt's section then the opening section on the first prompt only", () => {
    const output = runScenario(`
useOpeningFixtures();
const first = await handlers["before_agent_start"](${PROMPT_EVENT}, ctxWith());
const second = await handlers["before_agent_start"](${PROMPT_EVENT}, ctxWith());
captured = { first: sectionsOf(first), second: sectionsOf(second) };
    `);
    expect(output.captured.first).toHaveLength(2);
    expect(output.captured.first[0]).toContain("mem-prompt");
    expect(output.captured.first[0]).not.toContain("mem-open");
    expect(output.captured.first[1]).toContain("mem-open");
    expect(output.captured.first[1]).not.toContain("mem-prompt");
    expect(output.captured.second).toHaveLength(1);
    expect(output.searchQueries).toEqual([
      "how do we run the queue?",
      "project setup",
      "how do we run the queue?",
    ]);
  });

  it("adds no opening section while the option is off", () => {
    const output = runScenario(`
useOpeningFixtures();
stubConfig.openingContext = false;
captured = sectionsOf(await handlers["before_agent_start"](${PROMPT_EVENT}, ctxWith()));
    `);
    expect(output.captured).toHaveLength(1);
    expect(output.searchQueries).toEqual(["how do we run the queue?"]);
  });

  it("restores the session's own memories after session_compact and keeps them on later runs", () => {
    const output = runScenario(`
useOpeningFixtures();
const ctx = ctxWith();
const compactResult = await handlers["session_compact"]({ compactionEntry: {} }, ctx);
const one = await handlers["before_agent_start"](${PROMPT_EVENT}, ctx);
const two = await handlers["before_agent_start"](${PROMPT_EVENT}, ctx);
sessionMemories = [{ id: "mem-r2", memory: "Restore two", tags: [], metadata: { host: "pi" } }];
await handlers["session_compact"]({ compactionEntry: {} }, ctx);
const three = await handlers["before_agent_start"](${PROMPT_EVENT}, ctx);
captured = {
  compactResult: compactResult ?? null,
  one: sectionsOf(one), two: sectionsOf(two), three: sectionsOf(three),
};
    `);
    const { one, two, three } = output.captured;
    // The compaction already marked the session as seen: no opening section.
    expect(one).toHaveLength(2);
    expect(one[0]).toContain("mem-prompt");
    expect(one[1]).toContain("## Restored Session Memory");
    expect(one[1]).toContain("Restore one");
    expect(one[1]).not.toContain("Other host memory");
    expect(two[1]).toContain("Restore one");
    expect(three[1]).toContain("Restore two");
    expect(three[1]).not.toContain("Restore one");
    expect(output.captured.compactResult).toBeNull();
    expect(output.sessionSearches).toEqual([
      { sessionId: "pi-session-1", tag: "opencode_project_test", limit: 7 },
      { sessionId: "pi-session-1", tag: "opencode_project_test", limit: 7 },
    ]);
  });

  it("leaves Pi's compaction summary alone", () => {
    const output = runScenario(`
useOpeningFixtures();
captured = { beforeCompact: Object.keys(handlers).includes("session_before_compact") };
    `);
    expect(output.captured).toEqual({ beforeCompact: false });
  });

  it("restores after a session_start with reason resume and adds no opening section", () => {
    const output = runScenario(`
useOpeningFixtures();
const ctx = ctxWith([USER_ENTRY]);
await handlers["session_start"]({ reason: "resume" }, ctx);
const reply = await handlers["before_agent_start"](${PROMPT_EVENT}, ctx);
captured = sectionsOf(reply);
    `);
    expect(output.captured).toHaveLength(2);
    expect(output.captured[1]).toContain("Restore one");
    expect(output.searchQueries).toEqual(["how do we run the queue?"]);
    expect(output.sessionSearches).toHaveLength(1);
  });

  it("restores, with no opening section, on the first prompt of a branch with earlier user entries", () => {
    const output = runScenario(`
useOpeningFixtures();
const ctx = ctxWith([USER_ENTRY]);
const one = await handlers["before_agent_start"](${PROMPT_EVENT}, ctx);
const two = await handlers["before_agent_start"](${PROMPT_EVENT}, ctx);
captured = { one: sectionsOf(one), two: sectionsOf(two) };
    `);
    expect(output.captured.one).toHaveLength(2);
    expect(output.captured.one[1]).toContain("Restore one");
    expect(output.captured.two).toHaveLength(2);
    expect(output.searchQueries).toEqual(["how do we run the queue?", "how do we run the queue?"]);
    // Loaded once for the session, not on every run.
    expect(output.sessionSearches).toHaveLength(1);
  });

  it("restores nothing when compaction.enabled is false", () => {
    const output = runScenario(`
useOpeningFixtures();
stubConfig.compaction = { enabled: false, memoryLimit: 7 };
const compacted = ctxWith();
await handlers["session_compact"]({ compactionEntry: {} }, compacted);
const a = await handlers["before_agent_start"](${PROMPT_EVENT}, compacted);
const resumed = ctxWith([USER_ENTRY], "pi-session-2");
await handlers["session_start"]({ reason: "resume" }, resumed);
const b = await handlers["before_agent_start"](${PROMPT_EVENT}, resumed);
const c = await handlers["before_agent_start"](${PROMPT_EVENT}, ctxWith([USER_ENTRY], "pi-session-3"));
captured = { a: sectionsOf(a), b: sectionsOf(b), c: sectionsOf(c) };
    `);
    expect(output.captured.a).toHaveLength(1);
    expect(output.captured.b).toHaveLength(1);
    expect(output.captured.c).toHaveLength(1);
    expect(output.sessionSearches).toEqual([]);
  });

  it("clears the restored section on session_shutdown", () => {
    const output = runScenario(`
useOpeningFixtures();
const ctx = ctxWith();
await handlers["session_compact"]({ compactionEntry: {} }, ctx);
const before = await handlers["before_agent_start"](${PROMPT_EVENT}, ctx);
await handlers["session_shutdown"]({}, ctx);
const after = await handlers["before_agent_start"](${PROMPT_EVENT}, ctx);
captured = { before: sectionsOf(before), after: sectionsOf(after) };
    `);
    expect(output.captured.before).toHaveLength(2);
    expect(output.captured.after).toHaveLength(1);
  });

  it("gives a child (OMPS_CHILD=1) the prompt's recall only when subagentMemory is on", () => {
    const output = runScenario(`
useOpeningFixtures();
process.env.OMPS_CHILD = "1";
const ctx = ctxWith([USER_ENTRY], "pi-child-1", { mode: "rpc" });
await handlers["session_start"]({ reason: "resume" }, ctx);
await handlers["session_compact"]({ compactionEntry: {} }, ctx);
const on = await handlers["before_agent_start"](${PROMPT_EVENT}, ctx);
const onQueries = searchQueries.splice(0);
stubConfig.subagentMemory = false;
const off = await handlers["before_agent_start"](${PROMPT_EVENT}, ctx);
captured = { on: sectionsOf(on), off: off ?? null, onQueries, offQueries: searchQueries };
    `);
    expect(output.captured.on).toHaveLength(1);
    expect(output.captured.on[0]).toContain("mem-prompt");
    expect(output.captured.onQueries).toEqual(["how do we run the queue?"]);
    expect(output.captured.off).toBeNull();
    expect(output.captured.offQueries).toEqual([]);
    expect(output.sessionSearches).toEqual([]);
  });

  it("gives a first-prompt child no opening section", () => {
    const output = runScenario(`
useOpeningFixtures();
process.env.OMPS_CHILD = "1";
captured = sectionsOf(await handlers["before_agent_start"](${PROMPT_EVENT}, ctxWith([], "pi-child-2", { mode: "rpc" })));
    `);
    expect(output.captured).toHaveLength(1);
    expect(output.searchQueries).toEqual(["how do we run the queue?"]);
  });

  const widgetRows = (calls: any[]) => calls.at(-1)?.[1] ?? null;

  it("draws an opening row after the prompt's row, and one restore row per restore", () => {
    const output = runScenario(`
useOpeningFixtures();
const first = ctxWith();
await handlers["before_agent_start"](${PROMPT_EVENT}, first);
const afterFirst = widgetCalls.at(-1);
widgetCalls.splice(0);
await handlers["session_compact"]({ compactionEntry: {} }, first);
await handlers["before_agent_start"](${PROMPT_EVENT}, first);
await handlers["before_agent_start"](${PROMPT_EVENT}, first);
const afterTwoRuns = widgetCalls.at(-1);
await handlers["session_compact"]({ compactionEntry: {} }, first);
await handlers["before_agent_start"](${PROMPT_EVENT}, first);
captured = { afterFirst, afterTwoRuns, afterSecondRestore: widgetCalls.at(-1) };
    `);
    expect(widgetRows([output.captured.afterFirst])).toEqual([
      '▸ ● memory [mode=search, query="how do we run the queue?", limit=1]',
      '▸ ● memory [mode=opening, query="project setup", limit=1]',
    ]);
    const restoreRow = "▸ ● memory [mode=restore, limit=1]";
    const search = '▸ ● memory [mode=search, query="how do we run the queue?", limit=1]';
    // The first prompt's search row stays; two runs after one compaction add two search rows and
    // one restore row.
    expect(
      widgetRows([output.captured.afterTwoRuns]).filter((l: string) => l === restoreRow)
    ).toHaveLength(1);
    expect(
      widgetRows([output.captured.afterTwoRuns]).filter((l: string) => l === search)
    ).toHaveLength(3);
    // The second compaction replaces the restore, so one more restore row.
    const lines = widgetRows([output.captured.afterSecondRestore]);
    expect(lines.filter((l: string) => l === restoreRow)).toHaveLength(2);
  });

  it("draws no opening or restore row in RPC mode or with visibleRecall off, and still injects", () => {
    const output = runScenario(`
useOpeningFixtures();
const rpc = await handlers["before_agent_start"](${PROMPT_EVENT}, ctxWith([], "pi-rpc", { mode: "rpc" }));
const rpcWidgets = widgetCalls.splice(0);
stubConfig.visibleRecall = false;
const off = await handlers["before_agent_start"](${PROMPT_EVENT}, ctxWith([], "pi-off"));
await handlers["session_compact"]({ compactionEntry: {} }, ctxWith([], "pi-off"));
const offRestore = await handlers["before_agent_start"](${PROMPT_EVENT}, ctxWith([], "pi-off"));
captured = {
  rpc: sectionsOf(rpc), rpcWidgets, off: sectionsOf(off), offRestore: sectionsOf(offRestore),
  offWidgetsAllCleared: widgetCalls.every((call) => call[1] === null),
};
    `);
    expect(output.captured.rpc).toHaveLength(2);
    expect(output.captured.rpcWidgets).toEqual([]);
    expect(output.captured.off).toHaveLength(2);
    expect(output.captured.offRestore).toHaveLength(2);
    expect(output.captured.offWidgetsAllCleared).toBe(true);
  });
});
