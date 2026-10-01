import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = (path: string) => new URL(path, import.meta.url).href;
const SECRET = "claude-health-secret-value";
const READY = {
  memoryModel: "glm-5.3",
  memoryApiUrl: "https://api.invalid/v1",
  memoryApiKey: SECRET,
};

/** Run the Health checks with the heavy checks and the snapshot stubbed. */
function runHealth(config: Record<string, unknown>, snapshot: unknown, testModels = false): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-health-claude-"));
  try {
    const script = join(dir, "scenario.mjs");
    writeFileSync(
      script,
      `
import { mock } from "bun:test";
const settings = { storagePath: ${JSON.stringify(dir)}, opencodeProvider: "zai", opencodeModel: "glm-5",
  autoCaptureEnabled: true, memoryProvider: "openai-chat", ...${JSON.stringify(config)} };
mock.module(${JSON.stringify(url("../src/config.js"))}, () => ({ CONFIG: settings }));
mock.module(${JSON.stringify(url("../src/services/settings-snapshot.js"))}, () => ({ getSettingsSnapshot: () => (${JSON.stringify(snapshot)}) }));
mock.module(${JSON.stringify(url("../src/services/turso/connection-manager.js"))}, () => ({
  tursoConnectionManager: { getConnection: async () => ({ all: async () => [] }) } }));
mock.module(${JSON.stringify(url("../src/services/embedding.js"))}, () => ({
  embeddingService: { embedWithTimeout: async () => [1] } }));
mock.module(${JSON.stringify(url("../src/services/capture-attempt-store.js"))}, () => ({
  queryCaptureAttempts: async () => ({ byModel: [], byReason: [] }) }));
let calls = 0;
mock.module(${JSON.stringify(url("../src/importer/model-selection.js"))}, () => ({
  selectImportModel: () => ({ capture: { summarize: async () => { calls++; return { type: "skip" }; } } }) }));
const { runSettingsHealth } = await import(${JSON.stringify(url("../src/importer/settings-health.js"))});
const result = await runSettingsHealth({ directory: ${JSON.stringify(dir)}, host: "127.0.0.1",
  authEnabled: false, apiTokenSet: false, testModels: ${testModels} });
console.log("RESULT:" + JSON.stringify({ calls, checks: result.checks }));
`
    );
    const child = Bun.spawnSync(["bun", "run", script], { cwd: dir, env: { ...process.env } });
    const match = child.stdout.toString().match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`${child.stdout.toString()}\n${child.stderr.toString()}`);
    return JSON.parse(match[1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const row = (result: any, name: string) =>
  result.checks.find((check: { check: string }) => check.check === name);
const snapshot = (ready: boolean, exists: boolean, issues: string[] = []) => ({
  effective: { "claude-code": ready ? { ready, mode: "manual", issues } : { ready, issues } },
  claudeFolder: { root: "/home/me/.claude/projects", source: "default", exists },
});

it("passes both Claude Code rows when the external API and the folder are ready", () => {
  const result = runHealth(READY, snapshot(true, true));
  expect(row(result, "Claude Code model").status).toBe("pass");
  expect(row(result, "Claude Code folder").status).toBe("pass");
});

it("fails the model row with the missing setting and no secret", () => {
  const result = runHealth(
    { ...READY, memoryApiKey: "" },
    snapshot(false, true, ["memoryApiKey is not configured"])
  );
  const model = row(result, "Claude Code model");
  expect(model.status).toBe("fail");
  expect(model.reason).toContain("memoryApiKey");
  expect(JSON.stringify(result)).not.toContain(SECRET);
});

it("warns with the folder path when the transcripts folder is missing", () => {
  const folder = row(runHealth(READY, snapshot(true, false)), "Claude Code folder");
  expect(folder.status).toBe("warn");
  expect(folder.reason).toContain("/home/me/.claude/projects");
});

it("fails, and does not throw, when the snapshot has no Claude Code data", () => {
  const result = runHealth(READY, {});
  expect(row(result, "Claude Code model").status).toBe("fail");
  expect(row(result, "Claude Code folder").status).toBe("fail");
});

it("tests Pi and Claude Code with one external API call", () => {
  const result = runHealth({ ...READY, piModel: "external" }, snapshot(true, true), true);
  expect(row(result, "Pi model test").status).toBe("pass");
  expect(row(result, "Claude Code model test").status).toBe("pass");
  expect(result.calls).toBe(1);
});
