import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = (path: string) => new URL(path, import.meta.url).href;

/** Run the model tests of the Health page with the heavy checks stubbed. */
function runHealth(config: Record<string, unknown>): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-health-skip-"));
  try {
    const script = join(dir, "scenario.mjs");
    writeFileSync(
      script,
      `
import { mock } from "bun:test";
const settings = { storagePath: ${JSON.stringify(dir)}, opencodeProvider: "zai", opencodeModel: "glm-5",
  autoCaptureEnabled: true, memoryProvider: "openai-chat", ...${JSON.stringify(config)} };
mock.module(${JSON.stringify(url("../src/config.js"))}, () => ({ CONFIG: settings }));
mock.module(${JSON.stringify(url("../src/services/settings-snapshot.js"))}, () => ({ getSettingsSnapshot: () => ({}) }));
mock.module(${JSON.stringify(url("../src/services/turso/connection-manager.js"))}, () => ({
  tursoConnectionManager: { getConnection: async () => ({ all: async () => [] }) } }));
mock.module(${JSON.stringify(url("../src/services/embedding.js"))}, () => ({
  embeddingService: { embedWithTimeout: async () => [1] } }));
mock.module(${JSON.stringify(url("../src/services/capture-attempt-store.js"))}, () => ({
  queryCaptureAttempts: async () => ({ byModel: [], byReason: [] }) }));
const { runSettingsHealth } = await import(${JSON.stringify(url("../src/importer/settings-health.js"))});
const result = await runSettingsHealth({ directory: ${JSON.stringify(dir)}, host: "127.0.0.1",
  authEnabled: false, apiTokenSet: false, testModels: true });
console.log("RESULT:" + JSON.stringify(result.checks.find((row) => row.check === "OpenCode model test")));
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

it("reports the OpenCode model test as skipped with the reason when no host models exist", () => {
  const row = runHealth({});
  expect(row.status).toBe("warn");
  expect(row.reason).toContain("Skipped");
  expect(row.reason).toContain("inside OpenCode");
  expect(row.reason).toContain("external API");
});

it("skips an inherited OpenCode model with the same reason", () => {
  const row = runHealth({ opencodeProvider: "", opencodeModel: "inherit" });
  expect(row.status).toBe("warn");
  expect(row.reason).toContain("Skipped");
});
