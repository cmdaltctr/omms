import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Host parity (CLAUDE.md "Host parity"): the same two prompts must reach the profile pass after
// the same number of prompts, with the same prompt count, on OpenCode and on Pi. The first
// prompt is worth saving. The second is a preference-only prompt, so capture decides "skip".
// With `userProfileAnalysisInterval: 2` the pass runs after the second prompt on both hosts.
// OpenCode used to delete the skipped prompt, so its pass saw one prompt and waited for a third.
//
// Each host runs in its own child process, with its own empty home folder and store. OpenCode
// goes through the real V2 `setup` with the fake V2 context. Pi goes through the real extension's
// `agent_settled` handler. Both hosts use the real prompt store and the real profile pass. Only
// the capture decision (one shared function) and the profile model are replaced, and the pass is
// wrapped to record what it saw. The 10 s OpenCode idle delay is cut to 5 ms in the child.
setDefaultTimeout(120_000);

const url = (path: string) => new URL(path, import.meta.url).href;
const SKIP_PROMPT = "From now on always use British spelling in every document you write";
const SAVE_PROMPT = "Please refactor the settings page into three smaller components";

// Shared by both scripts: the mocks, and the wrapped pass that records what it saw.
const PRELUDE = `
import { mock } from "bun:test";

const passes = [];
let afterPrompt = 0;

const capture = await import(${JSON.stringify(url("../src/core/capture.js"))});
mock.module(${JSON.stringify(url("../src/core/capture.js"))}, () => ({
  ...capture,
  // One capture decision for both hosts: the preference-only prompt is skipped.
  captureConversation: async (unit) =>
    unit.userPrompt.includes("British spelling")
      ? { status: "skipped", type: "skip" }
      : { status: "captured", memoryId: "mem-" + unit.promptId },
}));
const drain = await import(${JSON.stringify(url("../src/services/capture-retry-drain.js"))});
mock.module(${JSON.stringify(url("../src/services/capture-retry-drain.js"))}, () => ({
  ...drain,
  startCaptureRetryDrain: () => {},
}));
const cleanup = await import(${JSON.stringify(url("../src/services/cleanup-service.js"))});
mock.module(${JSON.stringify(url("../src/services/cleanup-service.js"))}, () => ({
  ...cleanup,
  cleanupService: { runDailyMaintenance: async () => {} },
}));

const pass = await import(${JSON.stringify(url("../src/core/profile-learning/pass.js"))});
const { userPromptManager } = await import(
  ${JSON.stringify(url("../src/services/user-prompt/user-prompt-manager.js"))}
);
const stubModel = {
  provider: "stub",
  modelId: "stub",
  complete: async () => JSON.stringify({ preferences: [], patterns: [], workflows: [] }),
};
mock.module(${JSON.stringify(url("../src/core/profile-learning/pass.js"))}, () => ({
  ...pass,
  runProfileLearningPass: async (input) => {
    const waiting = await userPromptManager.countUnanalyzedForUserLearning();
    const result = await pass.runProfileLearningPass({ ...input, model: () => stubModel });
    passes.push({ afterPrompt, waiting, outcome: result.outcome });
    return result;
  },
}));

async function waitFor(condition, what) {
  const end = Date.now() + 30_000;
  while (!condition()) {
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function finish() {
  const waitingAtEnd = await userPromptManager.countUnanalyzedForUserLearning();
  const stored = await userPromptManager.getCapturedPrompts();
  console.log("RESULT:" + JSON.stringify({ passes, storedPrompts: stored.length, waitingAtEnd }));
  process.exit(0);
}
`;

const OPENCODE_SCRIPT = (directory: string) => `
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms === 10_000 ? 5 : ms, ...args);
${PRELUDE}
const { createFakeV2Context } = await import(${JSON.stringify(url("./fake-v2-context.ts"))});
globalThis[Symbol.for("omms.plugin.warmedup")] = true;
const plugin = (await import(${JSON.stringify(url("../src/v2/plugin.js"))})).default;

const directory = ${JSON.stringify(directory)};
const sessionID = "ses-parity";
const messages = [];
const fake = createFakeV2Context({ directory, messages: { [sessionID]: messages } });
const stop = await plugin.setup(fake.ctx);

const texts = [${JSON.stringify(SAVE_PROMPT)}, ${JSON.stringify(SKIP_PROMPT)}];
for (let i = 0; i < texts.length; i++) {
  afterPrompt = i + 1;
  const id = "m-" + afterPrompt;
  messages.push({ id, type: "user" }, { id: "a-" + afterPrompt, type: "assistant", content: [{ type: "text", text: "Done." }] });
  await fake.hooks.get("prompt")({ sessionID, messageID: id, prompt: { text: texts[i] } });
  await fake.hooks.get("context")({
    sessionID,
    model: { providerID: "p", id: "m" },
    system: [],
    messages: [{ id, role: "user" }],
  });
  fake.emit({ type: "session.execution.succeeded", location: { directory }, data: { sessionID } });
  await waitFor(() => passes.length === afterPrompt, "the profile pass after prompt " + afterPrompt);
}
await stop();
await finish();
`;

const PI_SCRIPT = (directory: string) => `
${PRELUDE}
const { default: ommsPiExtension } = await import(${JSON.stringify(url("../src/adapters/pi/extension.js"))});

const handlers = {};
ommsPiExtension({
  on: (event, handler) => { handlers[event] = handler; },
  registerTool: () => {},
  registerCommand: () => {},
});

const branch = [];
const ctx = {
  cwd: ${JSON.stringify(directory)},
  hasUI: false,
  mode: "print",
  ui: { notify() {}, setStatus() {}, setWidget() {} },
  sessionManager: { getSessionId: () => "pi-parity", getBranch: () => branch },
  model: { provider: "test", id: "model-x" },
  modelRegistry: { find: () => null, complete: async () => ({ content: [], stopReason: "stop" }) },
};

const texts = [${JSON.stringify(SAVE_PROMPT)}, ${JSON.stringify(SKIP_PROMPT)}];
for (let i = 0; i < texts.length; i++) {
  afterPrompt = i + 1;
  const stamp = "2026-01-01T10:00:0" + i + ".000Z";
  branch.push(
    { type: "message", id: "u-" + afterPrompt, parentId: null, timestamp: stamp, message: { role: "user", content: texts[i] } },
    { type: "message", id: "a-" + afterPrompt, parentId: null, timestamp: stamp, message: { role: "assistant", content: [{ type: "text", text: "Done." }] } }
  );
  await handlers["agent_settled"]({}, ctx);
  await waitFor(() => passes.length === afterPrompt, "the profile pass after prompt " + afterPrompt);
}
await finish();
`;

interface HostRun {
  passes: Array<{ afterPrompt: number; waiting: number; outcome: string }>;
  storedPrompts: number;
  waitingAtEnd: number;
}

async function runHost(script: (directory: string) => string): Promise<HostRun> {
  const root = mkdtempSync(join(tmpdir(), "omms-skip-parity-"));
  const home = join(root, "home");
  const work = join(root, "work");
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(
    join(home, ".config", "omms", "omms.jsonc"),
    JSON.stringify({
      webServerEnabled: false,
      chatMessage: { enabled: false },
      opencodeProvider: "opencode-go",
      opencodeModel: "test-model",
      autoCaptureEnabled: true,
      showAutoCaptureToasts: false,
      showUserProfileToasts: false,
      showErrorToasts: false,
      userProfileAnalysisInterval: 2,
    })
  );
  const scriptPath = join(root, "scenario.mjs");
  writeFileSync(scriptPath, script(work));
  try {
    const child = Bun.spawn([process.execPath, "run", scriptPath], {
      cwd: work,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        OMMS_DISABLE_WEB_AUTOSTART: "1",
        OMMS_DISABLE_AUTO_BACKFILL: "1",
        OMMS_DISABLE_UPDATE_CHECK: "1",
      },
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await child.exited;
    const match = stdout.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`scenario produced no result: ${stdout}\n${stderr}`);
    return JSON.parse(match[1]!) as HostRun;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("a save-worthy prompt, then a preference-only prompt that capture skips", () => {
  it("reaches the profile pass after the same prompts on OpenCode and on Pi", async () => {
    const [opencode, pi] = await Promise.all([runHost(OPENCODE_SCRIPT), runHost(PI_SCRIPT)]);

    // Interval 2: the first prompt waits, the second makes two, and the pass runs on them.
    const expected = [
      { afterPrompt: 1, waiting: 1, outcome: "skipped" },
      { afterPrompt: 2, waiting: 2, outcome: "saved" },
    ];
    expect(pi.passes).toEqual(expected);
    expect(opencode.passes).toEqual(expected);
    // Both prompts stay stored, and the pass learned both of them.
    expect(pi).toMatchObject({ storedPrompts: 2, waitingAtEnd: 0 });
    expect(opencode).toEqual(pi);
  });
});
