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
const toasts = [];
const client = { tui: { showToast: async ({ body }) => { toasts.push(body); } } };
const { OmmsPlugin } = await import(${JSON.stringify(url("../src/index.js"))});
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
const hooks = await OmmsPlugin({ directory: "/workspace", client });
await new Promise((resolve) => setTimeout(resolve, 50));
console.log("RESULT:" + JSON.stringify({ ensure: ensureCalls, webServerUses, toasts }));
await hooks.dispose?.();
`);
  expect(result.webServerUses).toEqual([]);
  expect(result.ensure).toEqual([
    { settings: { enabled: true, baseUrl: "http://127.0.0.1:4747" }, budgetMs: 10000 },
  ]);
  expect(result.toasts).toHaveLength(1);
  expect(result.toasts[0]).toMatchObject({
    title: "Memory Explorer",
    message: "Web UI available at http://127.0.0.1:4747",
    variant: "info",
  });
});

it("asks the web app check to replace an older web app with the recorded version", () => {
  const result = runScenario(`
replaceOlder = { version: "4.3.2", headers: { "x-omms-token": "local" } };
const hooks = await OmmsPlugin({ directory: "/workspace", client });
await new Promise((resolve) => setTimeout(resolve, 50));
console.log("RESULT:" + JSON.stringify({ ensure: ensureCalls }));
await hooks.dispose?.();
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
const hooks = await OmmsPlugin({ directory: "/workspace", client });
await new Promise((resolve) => setTimeout(resolve, 50));
console.log("RESULT:" + JSON.stringify({ settings: replaceSettings[0] }));
await hooks.dispose?.();
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
const hooks = await OmmsPlugin({ directory: "/workspace", client });
await new Promise((resolve) => setTimeout(resolve, 50));
console.log("RESULT:" + JSON.stringify({ toasts }));
await hooks.dispose?.();
`);
  expect(result.toasts).toHaveLength(1);
  expect(result.toasts[0]).toMatchObject({ variant: "error" });
  expect(result.toasts[0].message).toContain("4747");
});

it("starts nothing when webServerEnabled is false", () => {
  const result = runScenario(
    `
const hooks = await OmmsPlugin({ directory: "/workspace", client });
await new Promise((resolve) => setTimeout(resolve, 50));
console.log("RESULT:" + JSON.stringify({ ensure: ensureCalls, toasts }));
await hooks.dispose?.();
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
const hooks = await OmmsPlugin({ directory: "/workspace", client: { ...client, session: { get: async () => ({ data: { title: "chat" } }) } } });
await hooks.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
await new Promise((resolve) => realSetTimeout(resolve, 100));
console.log("RESULT:" + JSON.stringify({ learning: learning.length, cleanups: cleanups.length }));
await hooks.dispose?.();
`);
  expect(result).toEqual({ learning: 1, cleanups: 1 });
});
