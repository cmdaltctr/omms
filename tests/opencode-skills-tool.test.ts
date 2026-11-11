import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = (path: string) => new URL(path, import.meta.url).href;

/**
 * The OpenCode V2 `skills` tool (task 6.3), registered by the V2 plugin's `setup`. The plugin
 * starts with stubbed services, and the shared skill operations are stubbed to record each call.
 */
function runScenario(): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-opencode-skills-tool-"));
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
  loadOpencodeProvider: async () => ({ setConnectedProviders: () => {} }) }));
mock.module(${JSON.stringify(url("../src/importer/auto-backfill.js"))}, () => ({
  scheduleAutoBackfill: async () => {} }));
mock.module(${JSON.stringify(url("../src/services/logger.js"))}, () => ({ log: () => {} }));
mock.module(${JSON.stringify(url("../src/services/runtime-handoff.js"))}, () => ({
  registerOwnCopy: () => "written" }));
mock.module(${JSON.stringify(url("../src/services/user-prompt/user-prompt-manager.js"))}, () => ({
  userPromptManager: { savePrompt: async () => {} } }));
const calls = [];
mock.module(${JSON.stringify(url("../src/core/skill-operations.js"))}, () => ({
  runSkillOperation: async (mode, args, deps) => {
    calls.push({ mode, args, deps });
    return { success: false, mode, code: "recording-off", text: "Skill learning is off" };
  } }));
mock.module(${JSON.stringify(url("../src/services/skill-learning/operations-deps.js"))}, () => ({
  skillOperationsDeps: (directory, appliedBy) => ({ directory, appliedBy }) }));
const { createFakeV2Context } = await import(${JSON.stringify(url("./fake-v2-context.ts"))});
const plugin = (await import(${JSON.stringify(url("../src/v2/plugin.js"))})).default;
const fake = createFakeV2Context({ directory: ${JSON.stringify(dir)} });
const cleanup = await plugin.setup(fake.ctx);
const skills = fake.tools.get("skills");
const reply = await fake.runTool("skills", { mode: "apply", id: "p-1" }, {});
console.log("RESULT:" + JSON.stringify({ tools: [...fake.tools.keys()].sort(),
  description: skills.description, codemode: skills.options?.codemode,
  modes: skills.input.properties.mode.enum,
  argNames: Object.keys(skills.input.properties).sort(), reply: JSON.parse(reply.content), calls }));
await cleanup();
`
    );
    const child = Bun.spawnSync(["bun", "run", script], {
      cwd: dir,
      env: {
        ...process.env,
        HOME: join(dir, "home"),
        USERPROFILE: join(dir, "home"),
        OMMS_DISABLE_AUTO_BACKFILL: "1",
        OMMS_DISABLE_WEB_AUTOSTART: "1",
        OMMS_DISABLE_UPDATE_CHECK: "1",
      },
    });
    const stdout = child.stdout.toString();
    const match = stdout.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`${stdout}\n${child.stderr.toString()}`);
    return { ...JSON.parse(match[1]!), dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it("registers the skills tool beside memory and runs the shared operations as the agent", () => {
  const out = runScenario();
  expect(out.tools).toEqual(["memory", "skills"]);
  expect(out.codemode).toBe(false);
  expect(out.description).toContain("ranked by use");
  expect(out.description).toContain("only when the user asks");
  expect(out.modes).toEqual([
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
  expect(out.argNames).toEqual([
    "content",
    "evidence",
    "folder",
    "id",
    "idea",
    "limit",
    "mode",
    "order",
    "skill",
    "state",
    "summary",
  ]);
  expect(out.reply).toEqual({
    success: false,
    mode: "apply",
    code: "recording-off",
    text: "Skill learning is off",
  });
  expect(out.calls).toEqual([
    { mode: "apply", args: { id: "p-1" }, deps: { directory: out.dir, appliedBy: "agent" } },
  ]);
});
