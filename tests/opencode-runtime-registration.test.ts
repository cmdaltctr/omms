import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = (path: string) => new URL(path, import.meta.url).href;

/** Start the OpenCode plugin with a stubbed record service, and print what it did. */
function runScenario(registerFails: boolean): { calls: number; logged: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "omms-opencode-record-test-"));
  try {
    const script = join(dir, "scenario.mjs");
    writeFileSync(
      script,
      `
import { mock } from "bun:test";
const settings = { storagePath: ${JSON.stringify(join(dir, "store"))}, autoBackfill: false,
  autoCaptureEnabled: false, webServerEnabled: false, chatMessage: { enabled: false } };
mock.module(${JSON.stringify(url("../src/config.js"))}, () => ({ CONFIG: settings,
  initConfigWithLegacyMigration: () => {}, refreshConfigIfChanged: () => {},
  getExplicitContainerTagPrefix: () => undefined, isConfigured: () => true }));
mock.module(${JSON.stringify(url("../src/services/client.js"))}, () => ({ memoryClient: {
  warmup: async () => {}, close: async () => {} } }));
mock.module(${JSON.stringify(url("../src/services/tags.js"))}, () => ({ getTags: () => ({
  project: { tag: "test" }, user: { userEmail: "test@example.invalid" } }) }));
mock.module(${JSON.stringify(url("../src/adapters/opencode/opencode-provider-loader.js"))}, () => ({
  loadOpencodeProvider: async () => ({ resetHostFetch: () => {}, setHostFetch: () => {},
    setV2Client: () => {}, createV2Client: () => ({}), setConnectedProviders: () => {} }) }));
mock.module(${JSON.stringify(url("../src/importer/auto-backfill.js"))}, () => ({
  scheduleAutoBackfill: async () => {} }));
const logs = [];
mock.module(${JSON.stringify(url("../src/services/logger.js"))}, () => ({ log: (message) => logs.push(message) }));
const registerCalls = [];
mock.module(${JSON.stringify(url("../src/services/runtime-handoff.js"))}, () => ({
  registerOwnCopy: () => {
    registerCalls.push(1);
    if (${registerFails}) throw new Error("record failed");
    return "written";
  } }));
mock.module(${JSON.stringify(url("../src/services/user-prompt/user-prompt-manager.js"))}, () => ({
  userPromptManager: { savePrompt: async () => {} } }));
const { OmmsPlugin } = await import(${JSON.stringify(url("../src/index.js"))});
const hooks = await OmmsPlugin({ directory: ${JSON.stringify(dir)}, client: {
  provider: { list: async () => ({ data: { connected: [] } }) },
  config: { get: async () => ({ data: {} }) },
} });
await new Promise((resolve) => setTimeout(resolve, 20));
console.log("RESULT:" + JSON.stringify({ calls: registerCalls.length,
  logged: logs.some((message) => message.includes("runtime record")) }));
await hooks.dispose();
`
    );
    // The web app switches stay off, to show that the record does not depend on them.
    const child = Bun.spawnSync(["bun", "run", script], {
      cwd: dir,
      env: { ...process.env, OMMS_DISABLE_AUTO_BACKFILL: "1", OMMS_DISABLE_WEB_AUTOSTART: "1" },
    });
    const stdout = child.stdout.toString();
    const match = stdout.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`${stdout}\n${child.stderr.toString()}`);
    return JSON.parse(match[1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it("records the OpenCode copy at plugin start", () => {
  expect(runScenario(false)).toEqual({ calls: 1, logged: false });
});

it("logs a record failure and still starts the plugin", () => {
  expect(runScenario(true)).toEqual({ calls: 1, logged: true });
});
