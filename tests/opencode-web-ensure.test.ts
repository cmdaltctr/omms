import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = (path: string) => new URL(path, import.meta.url).href;

function runScenario(body: string, config: Record<string, unknown> = {}): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-opencode-ensure-"));
  try {
    const script = join(dir, "scenario.mjs");
    writeFileSync(
      script,
      `
import { mock } from "bun:test";
const settings = { storagePath: ${JSON.stringify(join(dir, "store"))}, autoBackfill: false,
  webServerAutoStart: false, webServerEnabled: true, webServerHost: "127.0.0.1", webServerPort: 4747,
  autoCaptureEnabled: true, autoCaptureProviderStatus: { ready: true }, autoCleanupEnabled: true, chatMessage: { enabled: false },
  // Every first-run part off, so no first-run line joins the notices unless a test asks.
  embeddingApiUrl: "http://embed.invalid",
  ${Object.entries(config)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ")} };
mock.module(${JSON.stringify(url("../src/config.js"))}, () => ({ CONFIG: settings,
  initConfigWithLegacyMigration: () => {}, refreshConfigIfChanged: () => {},
  getExplicitContainerTagPrefix: () => undefined, isConfigured: () => true }));
mock.module(${JSON.stringify(url("../src/services/client.js"))}, () => ({ memoryClient: {
  warmup: async () => {}, close: async () => {} } }));
mock.module(${JSON.stringify(url("../src/services/turso/ready.js"))}, () => ({
  ensureTursoReady: async () => {} }));
mock.module(${JSON.stringify(url("../src/services/tags.js"))}, () => ({ getTags: () => ({
  project: { tag: "test" }, user: { userEmail: "test@example.invalid" } }) }));
mock.module(${JSON.stringify(url("../src/services/logger.js"))}, () => ({ log: () => {} }));
mock.module(${JSON.stringify(url("../src/services/user-prompt/user-prompt-manager.js"))}, () => ({
  userPromptManager: { savePrompt: async () => {} } }));
const webServerUses = [];
mock.module(${JSON.stringify(url("../src/services/web-server.js"))}, () => ({
  startWebServer: async () => { webServerUses.push("start"); throw new Error("no web server in OpenCode"); },
  WebServer: class { constructor() { webServerUses.push("new"); throw new Error("no web server in OpenCode"); } },
}));
// Never read the developer's real record.
let replaceOlder;
const replaceSettings = [];
mock.module(${JSON.stringify(url("../src/services/runtime-handoff.js"))}, () => ({
  registerOwnCopy: () => "skipped",
  hostReplaceOlder: async (settings) => { replaceSettings.push(settings); return replaceOlder; } }));
const ensureCalls = [];
let ensureResult = "started";
mock.module(${JSON.stringify(url("../src/services/web-ensure.js"))}, () => ({
  ensureWebApp: async (options) => { ensureCalls.push(options); return ensureResult; } }));
const learning = [];
mock.module(${JSON.stringify(url("../src/adapters/opencode/profile-learning.js"))}, () => ({
  performUserProfileLearning: async () => { learning.push(1); } }));
mock.module(${JSON.stringify(url("../src/services/auto-capture.js"))}, () => ({
  performAutoCapture: async () => {} }));
const cleanups = [];
mock.module(${JSON.stringify(url("../src/services/cleanup-service.js"))}, () => ({
  cleanupService: { shouldRunCleanup: async () => true, runCleanup: async () => { cleanups.push(1); } } }));
// V2 shows no native toast. The legacy client prints "[omms] <title>: <message>" instead.
const toasts = [];
for (const method of ["info", "warn", "error"]) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    if (typeof args[0] === "string" && args[0].startsWith("[omms] ")) toasts.push({ method, text: args[0] });
    else original(...args);
  };
}
// The plugin starts the web app check in the background. A fixed wait fails on a slow runner,
// so wait for the call the test expects, up to two seconds.
const waitFor = async (condition, ms = 2000) => {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5));
};
const { createFakeV2Context } = await import(${JSON.stringify(url("./fake-v2-context.ts"))});
const { default: plugin } = await import(${JSON.stringify(url("../src/v2/plugin.js"))});
// Runs the V2 setup against a fake context. \`stop\` ends the event subscription.
const startPlugin = async (options = {}) => {
  const fake = createFakeV2Context({ directory: "/workspace", ...options });
  return { fake, stop: await plugin.setup(fake.ctx) };
};
${body}
`
    );
    const child = Bun.spawnSync(["bun", "run", script], {
      cwd: dir,
      // The plugin removes the login item when webServerAutoStart is false, so keep it off the real home.
      env: {
        ...process.env,
        HOME: dir,
        USERPROFILE: dir,
        OMMS_DISABLE_AUTO_BACKFILL: "1",
        OMMS_DISABLE_WEB_AUTOSTART: "0",
        OMMS_DISABLE_UPDATE_CHECK: "1",
      },
    });
    const stdout = child.stdout.toString();
    const match = stdout.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`${stdout}\n${child.stderr.toString()}`);
    return JSON.parse(match[1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it("checks for the shared web app once, starts no web server, and shows one toast", () => {
  const result = runScenario(`
const { stop } = await startPlugin();
await waitFor(() => toasts.length > 0);
console.log("RESULT:" + JSON.stringify({ ensure: ensureCalls, webServerUses, toasts }));
await stop();
`);
  expect(result.webServerUses).toEqual([]);
  expect(result.ensure).toEqual([
    { settings: { enabled: true, baseUrl: "http://127.0.0.1:4747" }, budgetMs: 10000 },
  ]);
  expect(result.toasts).toHaveLength(1);
  // `info` is the console method for the `info` variant.
  expect(result.toasts[0]).toEqual({
    method: "info",
    text: "[omms] Memory Explorer: Web UI available at http://127.0.0.1:4747",
  });
});

it("asks the web app check to replace an older web app with the recorded version", () => {
  const result = runScenario(`
replaceOlder = { version: "4.3.2", headers: { "x-omms-token": "local" } };
const { stop } = await startPlugin();
await waitFor(() => ensureCalls.length > 0);
console.log("RESULT:" + JSON.stringify({ ensure: ensureCalls }));
await stop();
`);
  expect(result.ensure).toEqual([
    {
      settings: { enabled: true, baseUrl: "http://127.0.0.1:4747" },
      budgetMs: 10000,
      replaceOlder: { version: "4.3.2", headers: { "x-omms-token": "local" } },
    },
  ]);
});

it("gives the browser password settings to the web app replacement", () => {
  const result = runScenario(
    `
const { stop } = await startPlugin();
await waitFor(() => replaceSettings.length > 0);
console.log("RESULT:" + JSON.stringify({ settings: replaceSettings[0] }));
await stop();
`,
    { webServerAuthPassword: "pw", webServerAuthUsername: "me" }
  );
  expect(result.settings).toMatchObject({
    webServerAuthPassword: "pw",
    webServerAuthUsername: "me",
  });
});

it("shows an error toast when another program holds the web port", () => {
  const result = runScenario(`
ensureResult = "port-busy";
const { stop } = await startPlugin();
await waitFor(() => toasts.length > 0);
console.log("RESULT:" + JSON.stringify({ toasts }));
await stop();
`);
  expect(result.toasts).toHaveLength(1);
  expect(result.toasts[0]).toMatchObject({ method: "error" });
  expect(result.toasts[0].text).toContain("Memory Explorer");
  expect(result.toasts[0].text).toContain("4747");
});

for (const result of ["port-busy", "no-runtime"] as const) {
  it(`uses the shared web-start wording for ${result}, at today's error level`, async () => {
    const { webStartNotice } = await import("../src/services/web-start-notice.js");
    const output = runScenario(`
ensureResult = ${JSON.stringify(result)};
const { stop } = await startPlugin();
await waitFor(() => toasts.length > 0);
console.log("RESULT:" + JSON.stringify({ toasts }));
await stop();
`);
    expect(output.toasts).toEqual([
      { method: "error", text: `[omms] Memory Explorer: ${webStartNotice(result, 4747)!.text}` },
    ]);
  });
}

it("writes the first-run notice to the log until a terminal interface has shown it", () => {
  const result = runScenario(
    `
const { mkdirSync, writeFileSync } = await import("node:fs");
const first = await startPlugin();
await waitFor(() => toasts.length > 1);
await first.stop();
const before = toasts.splice(0);
mkdirSync(settings.storagePath, { recursive: true });
writeFileSync(settings.storagePath + "/first-run-notices.json", JSON.stringify({ opencode: true }));
const second = await startPlugin();
await waitFor(() => toasts.length > 0);
await new Promise((resolve) => setTimeout(resolve, 20));
await second.stop();
console.log("RESULT:" + JSON.stringify({ before, after: toasts }));
`,
    { embeddingApiUrl: "" }
  );
  const notices = (list: { text: string }[]) =>
    list.filter((toast) => toast.text.includes("OMMS does these things on its own"));
  expect(notices(result.before)).toHaveLength(1);
  expect(notices(result.before)[0]).toMatchObject({ method: "info" });
  expect(notices(result.before)[0]!.text).toContain("Embedding model");
  expect(notices(result.after)).toEqual([]);
});

it("starts nothing when webServerEnabled is false", () => {
  const result = runScenario(
    `
const { stop } = await startPlugin();
await new Promise((resolve) => setTimeout(resolve, 50));
console.log("RESULT:" + JSON.stringify({ ensure: ensureCalls, toasts }));
await stop();
`,
    { webServerEnabled: false }
  );
  expect(result.ensure).toEqual([]);
  expect(result.toasts).toEqual([]);
});

it("runs profile learning and cleanup on idle with no in-process web server", () => {
  const result = runScenario(`
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms === 10000 ? 0 : ms, ...rest);
const { fake, stop } = await startPlugin({
  sessions: { s1: { id: "s1", title: "chat", location: { directory: "/workspace" } } },
});
// V2 ends a turn with session.execution.succeeded; the legacy bridge maps it to session.idle.
fake.emit({ type: "session.execution.succeeded", data: { sessionID: "s1" } });
await waitFor(() => learning.length > 0 && cleanups.length > 0);
await new Promise((resolve) => realSetTimeout(resolve, 50));
console.log("RESULT:" + JSON.stringify({ learning: learning.length, cleanups: cleanups.length }));
await stop();
`);
  expect(result).toEqual({ learning: 1, cleanups: 1 });
});
