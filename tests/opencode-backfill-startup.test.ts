import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = (path: string) => new URL(path, import.meta.url).href;

it("starts OpenCode backfill after providers load and uses the configured default", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-opencode-backfill-test-"));
  try {
    const script = join(dir, "scenario.mjs");
    writeFileSync(
      script,
      `
import { mock } from "bun:test";
const settings = { storagePath: ${JSON.stringify(join(dir, "store"))}, autoBackfill: true, webServerAutoStart: true, opencodeBackfillModel: "inherit",
  autoCaptureEnabled: false, webServerEnabled: false, chatMessage: { enabled: false } };
const calls = [];
mock.module(${JSON.stringify(url("../src/config.js"))}, () => ({ CONFIG: settings,
  initConfigWithLegacyMigration: () => {}, refreshConfigIfChanged: () => {},
  getExplicitContainerTagPrefix: () => undefined, isConfigured: () => true }));
mock.module(${JSON.stringify(url("../src/services/client.js"))}, () => ({ memoryClient: {
  warmup: async () => {}, close: async () => {} } }));
mock.module(${JSON.stringify(url("../src/services/tags.js"))}, () => ({ getTags: () => ({
  project: { tag: "test" }, user: { userEmail: "test@example.invalid" } }) }));
mock.module(${JSON.stringify(url("../src/services/ai/opencode-provider-loader.js"))}, () => ({
  loadOpencodeProvider: async () => ({ resetHostFetch: () => {}, setHostFetch: () => {},
    setV2Client: () => {}, createV2Client: () => ({}), setConnectedProviders: () => {} }) }));
mock.module(${JSON.stringify(url("../src/importer/auto-backfill.js"))}, () => ({
  scheduleAutoBackfill: async (options) => { calls.push(options); } }));
const logs = [];
const autostartCalls = [];
mock.module(${JSON.stringify(url("../src/services/logger.js"))}, () => ({ log: (message) => logs.push(message) }));
mock.module(${JSON.stringify(url("../src/services/web-autostart.js"))}, () => ({
  reconcileWebAutostart: () => { autostartCalls.push(1); throw new Error("failed"); } }));
mock.module(${JSON.stringify(url("../src/services/user-prompt/user-prompt-manager.js"))}, () => ({
  userPromptManager: { savePrompt: async () => {} } }));
mock.module(${JSON.stringify(url("../src/adapters/opencode/backfill-models.js"))}, () => ({
  resolveOpencodeBackfillModels: async (_config, ctx) => ({ model: await ctx.configModel(),
    models: {}, connected: ctx.connected }) }));
const { OmmsPlugin } = await import(${JSON.stringify(url("../src/index.js"))});
let loadProviders;
const providerReady = new Promise((resolve) => { loadProviders = resolve; });
const hooks = await OmmsPlugin({ directory: ${JSON.stringify(dir)}, client: {
  provider: { list: () => providerReady },
  config: { get: async () => ({ data: { model: "zai/default-model" } }) },
} });
const before = calls.length;
loadProviders({ data: { connected: ["zai"] } });
await new Promise((resolve) => setTimeout(resolve, 20));
const selected = await calls[0]?.resolveModels();
console.log("RESULT:" + JSON.stringify({ before, count: calls.length,
  model: selected?.model, connected: selected?.connected,
  autostart: autostartCalls.length, logged: logs.some((message) => message.includes("login item")) }));
await hooks.dispose();
`
    );
    const child = Bun.spawnSync(["bun", "run", script], {
      cwd: dir,
      env: { ...process.env, OMMS_DISABLE_AUTO_BACKFILL: "0", OMMS_DISABLE_WEB_AUTOSTART: "0" },
    });
    const stdout = child.stdout.toString();
    const match = stdout.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`${stdout}\n${child.stderr.toString()}`);
    expect(JSON.parse(match[1])).toEqual({
      before: 0,
      count: 1,
      model: "zai/default-model",
      connected: ["zai"],
      autostart: 1,
      logged: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
