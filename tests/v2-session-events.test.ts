import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These tests drive the real V2 plugin `setup` with a fake V2 context and push raw V2 events
// into it. They use public entry points only (`setup`, `ctx.event`, the registered hooks), so
// they do not depend on where the event and model code lives. Each scenario runs in its own
// Bun process with its own home folder and config file, and every service that does model or
// store work is replaced by a recorder. The idle scenarios wait out the real 10 s delay, so
// all scenarios start together at import and the tests only await their results.
setDefaultTimeout(60_000);

const url = (path: string) => new URL(path, import.meta.url).href;

/** The delay between a session going idle and the capture work. */
const IDLE_DELAY_MS = 10_000;

type ScenarioResult = Record<string, any>;

/**
 * Run `body` inside a child process after `setup` has run with `config` as the global config.
 * The body sees `fake` (the fake V2 context), `directory`, `recorded` (what the replaced
 * services were called with), `sleep` and `waitFor`, and sets `result` to the JSON to return.
 */
async function runScenario(
  config: Record<string, unknown>,
  body: string,
  fakeOptions: Record<string, unknown> = {}
): Promise<ScenarioResult> {
  const dir = mkdtempSync(join(tmpdir(), "omms-v2-session-events-"));
  try {
    const home = join(dir, "home");
    const project = join(dir, "project");
    mkdirSync(join(home, ".config", "omms"), { recursive: true });
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(home, ".config", "omms", "omms.jsonc"),
      JSON.stringify({ webServerEnabled: false, chatMessage: { enabled: false }, ...config })
    );
    const script = join(dir, "scenario.mjs");
    writeFileSync(
      script,
      `
import { mock } from "bun:test";
const recorded = { order: [], drains: [], capture: [], modelRows: [] };
const t = () => Date.now();

const autoCapture = await import(${JSON.stringify(url("../src/services/auto-capture.js"))});
mock.module(${JSON.stringify(url("../src/services/auto-capture.js"))}, () => ({
  ...autoCapture,
  performAutoCapture: async (_host, sessionID, directory) => {
    recorded.order.push({ name: "capture", at: t() });
    recorded.capture.push({ sessionID, directory });
  },
}));
const profile = await import(${JSON.stringify(url("../src/adapters/opencode/profile-learning.js"))});
mock.module(${JSON.stringify(url("../src/adapters/opencode/profile-learning.js"))}, () => ({
  ...profile,
  performUserProfileLearning: async () => { recorded.order.push({ name: "learning", at: t() }); },
}));
const cleanup = await import(${JSON.stringify(url("../src/services/cleanup-service.js"))});
mock.module(${JSON.stringify(url("../src/services/cleanup-service.js"))}, () => ({
  ...cleanup,
  cleanupService: {
    shouldRunCleanup: async () => true,
    runCleanup: async () => { recorded.order.push({ name: "cleanup", at: t() }); },
  },
}));
const drain = await import(${JSON.stringify(url("../src/services/capture-retry-drain.js"))});
mock.module(${JSON.stringify(url("../src/services/capture-retry-drain.js"))}, () => ({
  ...drain,
  startCaptureRetryDrain: (host) => { recorded.drains.push(host); },
}));
const prompts = await import(${JSON.stringify(url("../src/services/user-prompt/user-prompt-manager.js"))});
mock.module(${JSON.stringify(url("../src/services/user-prompt/user-prompt-manager.js"))}, () => ({
  ...prompts,
  userPromptManager: {
    reset: () => {},
    savePrompt: async (sessionID, messageID) => {
      recorded.modelRows.push({ call: "savePrompt", sessionID, messageID });
    },
    setPromptModel: async (messageID, providerID, modelID) => {
      recorded.modelRows.push({ call: "setPromptModel", messageID, providerID, modelID });
    },
  },
}));

// The store warm-up is not under test.
globalThis[Symbol.for("omms.plugin.warmedup")] = true;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (condition, ms) => {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await sleep(10);
};
const directory = ${JSON.stringify(project)};
const { createFakeV2Context } = await import(${JSON.stringify(url("./fake-v2-context.ts"))});
const plugin = (await import(${JSON.stringify(url("../src/v2/plugin.js"))})).default;
const fake = createFakeV2Context({ directory, ...${JSON.stringify(fakeOptions).replaceAll("PROJECT_DIRECTORY", project)} });
const stop = await plugin.setup(fake.ctx);
let result = {};
${body}
await stop();
console.log("RESULT:" + JSON.stringify({ ...result, recorded }));
process.exit(0);
`
    );
    const child = Bun.spawn([process.execPath, script], {
      cwd: dir,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        OMMS_DISABLE_WEB_AUTOSTART: "1",
        OMMS_DISABLE_AUTO_BACKFILL: "1",
        OMMS_DISABLE_UPDATE_CHECK: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await child.exited;
    const match = stdout.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`no result\n${stdout}\n${stderr}`);
    return JSON.parse(match[1]!);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A raw V2 event for a session of the plugin's own project directory. */
const rawEvent = (type: string, data: Record<string, unknown>) =>
  `{ type: ${JSON.stringify(type)}, location: { directory }, data: ${JSON.stringify(data)} }`;
const idle = (sessionID: string) => rawEvent("session.execution.succeeded", { sessionID });
const created = (sessionID: string) => rawEvent("session.created", { session: { id: sessionID } });

const names = (result: ScenarioResult) => result.recorded.order.map((entry: any) => entry.name);

// The internal title is read from the source so the test follows a rename.
const { INTERNAL_CAPTURE_SESSION_TITLE } =
  await import("../src/adapters/opencode/internal-capture-sessions.js");

// Start the slow scenarios now so their 10 s waits overlap.
const idleCaptureOn = runScenario(
  {},
  `
const emittedAt = Date.now();
fake.emit(${idle("ses-user")});
await sleep(${IDLE_DELAY_MS - 1_000});
const before = recorded.order.map((entry) => entry.name);
await waitFor(() => recorded.order.length >= 3, 15000);
result = {
  before,
  captureDelayMs: recorded.order[0] ? recorded.order[0].at - emittedAt : null,
};
`
);

const idleSkillLearningOnly = runScenario(
  { autoCaptureEnabled: false, skillLearning: true },
  `
fake.emit(${idle("ses-user")});
await waitFor(() => recorded.order.length >= 1, 15000);
// Give a wrongly started profile learning or cleanup time to show up.
await sleep(1500);
`
);

const idleInternal = runScenario(
  {},
  `
fake.emit(${idle("ses-internal")});
fake.emit(${created("ses-internal")});
// A user session after the internal events proves the event loop kept running.
fake.emit(${created("ses-user")});
await waitFor(() => recorded.drains.length >= 1, 3000);
await sleep(${IDLE_DELAY_MS + 500});
`,
  {
    sessions: {
      "ses-internal": {
        id: "ses-internal",
        title: INTERNAL_CAPTURE_SESSION_TITLE,
        location: { directory: "PROJECT_DIRECTORY" },
      },
    },
  }
);

describe("OpenCode V2 session events start capture", () => {
  it("runs capture after 10 s, then profile learning, then the cleanup check", async () => {
    const result = await idleCaptureOn;
    // Nothing has run one second before the delay ends.
    expect(result.before).toEqual([]);
    expect(result.captureDelayMs).toBeGreaterThanOrEqual(IDLE_DELAY_MS - 100);
    expect(names(result)).toEqual(["capture", "learning", "cleanup"]);
    expect(result.recorded.capture).toHaveLength(1);
    expect(result.recorded.capture[0].sessionID).toBe("ses-user");
  });

  it("records only the turn when capture is off and skillLearning is on", async () => {
    const result = await idleSkillLearningOnly;
    expect(names(result)).toEqual(["capture"]);
    expect(result.recorded.capture[0].sessionID).toBe("ses-user");
  });

  it("starts the OpenCode retry drain when a user session is created and capture is on", async () => {
    const result = await runScenario(
      {},
      `
fake.emit(${created("ses-user")});
await waitFor(() => recorded.drains.length >= 1, 3000);
`
    );
    expect(result.recorded.drains).toEqual(["opencode"]);
    expect(names(result)).toEqual([]);
  });

  it("does not start the retry drain when capture is off", async () => {
    const result = await runScenario(
      { autoCaptureEnabled: false },
      `
fake.emit(${created("ses-user")});
await sleep(500);
`
    );
    expect(result.recorded.drains).toEqual([]);
  });

  it("starts nothing for an OMMS internal session on idle or created", async () => {
    const result = await idleInternal;
    // Only the control user session started a drain; the internal one did not.
    expect(result.recorded.drains).toEqual(["opencode"]);
    expect(names(result)).toEqual([]);
    expect(result.recorded.capture).toEqual([]);
  });
});

describe("OpenCode V2 setup", () => {
  it("adds no agent to OpenCode's agent list", async () => {
    const result = await runScenario({}, `result = { agentTransform: fake.calls.agentTransform };`);
    expect(result.agentTransform).toBe(0);
  });
});

describe("OpenCode V2 records the session model for the prompt row", () => {
  const MODEL = { providerID: "anthropic", id: "claude-test" };

  /** Send one prompt, then its model request, through the registered v2 hooks. */
  const modelRequest = `
await fake.hooks.get("prompt")({ sessionID: "ses-model", messageID: "msg-1", prompt: { text: "Hello" } });
await fake.hooks.get("context")({
  sessionID: "ses-model",
  model: ${JSON.stringify(MODEL)},
  system: [],
  messages: [{ id: "msg-1", role: "user" }],
});
`;

  it("stores the request's provider and model after recording the prompt when opencodeModel is inherit", async () => {
    const result = await runScenario({ opencodeModel: "inherit" }, modelRequest);
    expect(result.recorded.modelRows).toEqual([
      { call: "savePrompt", sessionID: "ses-model", messageID: "msg-1" },
      {
        call: "setPromptModel",
        messageID: "msg-1",
        providerID: MODEL.providerID,
        modelID: MODEL.id,
      },
    ]);
  });

  it("stores the model when no host model is configured, so live calls follow the session", async () => {
    const result = await runScenario({}, modelRequest);
    const calls = result.recorded.modelRows.filter((row: any) => row.call === "setPromptModel");
    expect(calls).toEqual([
      {
        call: "setPromptModel",
        messageID: "msg-1",
        providerID: MODEL.providerID,
        modelID: MODEL.id,
      },
    ]);
  });

  it("lets inherit follow the latest request's model when OpenCode has no model.json", async () => {
    // Headless OpenCode (`opencode run`, `serve`, OpenChamber) writes no model.json, so an
    // inherit call without a prompt model must use the model the context hook last saw.
    const result = await runScenario(
      { opencodeModel: "inherit" },
      `${modelRequest}
const { resolveOpencodeModelRef } = await import(${JSON.stringify(url("../src/adapters/opencode/opencode-provider.js"))});
result = { resolved: resolveOpencodeModelRef({ providerID: "zai-coding-plan", modelID: "inherit" }) };
`
    );
    expect(result.resolved).toEqual({ providerID: MODEL.providerID, modelID: MODEL.id });
  });

  it("leaves the prompt row's model alone when a fixed host model is configured", async () => {
    const result = await runScenario(
      { opencodeProvider: "openai", opencodeModel: "gpt-test" },
      modelRequest
    );
    // The prompt itself is still recorded.
    expect(result.recorded.modelRows).toEqual([
      { call: "savePrompt", sessionID: "ses-model", messageID: "msg-1" },
    ]);
  });
});
