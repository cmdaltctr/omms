import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the real Settings health checks in a child process with only the heavy
// parts stubbed (store, embedding, attempt log, settings snapshot), and returns
// the rows exactly as the web app would send them.

const url = (path: string) => new URL(path, import.meta.url).href;

export interface RealHealthOptions {
  /** Breaks the embedding row. */
  embedFails?: boolean;
  /** The error message the broken embedding throws. */
  embedError?: string;
  /** Runs the model test rows, as `doctor` does by default. */
  testModels?: boolean;
}

export function realHealthRows(
  config: Record<string, unknown>,
  snapshot: unknown,
  options: RealHealthOptions = {}
): any[] {
  const embedError = JSON.stringify(options.embedError ?? "model download failed");
  const embedFails = options.embedFails === true || options.embedError !== undefined;
  const dir = mkdtempSync(join(tmpdir(), "omms-health-rows-"));
  try {
    const script = join(dir, "scenario.mjs");
    writeFileSync(
      script,
      `
import { mock } from "bun:test";
const settings = { storagePath: ${JSON.stringify(dir)}, autoCaptureEnabled: true, ...${JSON.stringify(config)} };
mock.module(${JSON.stringify(url("../src/config.js"))}, () => ({ CONFIG: settings }));
mock.module(${JSON.stringify(url("../src/services/settings-snapshot.js"))}, () => ({ getSettingsSnapshot: () => (${JSON.stringify(snapshot)}) }));
mock.module(${JSON.stringify(url("../src/services/turso/connection-manager.js"))}, () => ({
  tursoConnectionManager: { getConnection: async () => ({ all: async () => [] }) } }));
mock.module(${JSON.stringify(url("../src/services/embedding.js"))}, () => ({
  embeddingService: { embedWithTimeout: async () => { if (${embedFails}) throw new Error(${embedError}); return [1]; } } }));
mock.module(${JSON.stringify(url("../src/services/capture-attempt-store.js"))}, () => ({
  queryCaptureAttempts: async () => ({ byModel: [], byReason: [] }) }));
const { runSettingsHealth } = await import(${JSON.stringify(url("../src/importer/settings-health.js"))});
const result = await runSettingsHealth({ directory: ${JSON.stringify(dir)}, host: "127.0.0.1",
  authEnabled: false, apiTokenSet: false, testModels: ${options.testModels === true} });
console.log("RESULT:" + JSON.stringify(result.checks));
`
    );
    const child = Bun.spawnSync(["bun", "run", script], { cwd: dir, env: { ...process.env } });
    const match = child.stdout.toString().match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`${child.stdout.toString()}\n${child.stderr.toString()}`);
    return JSON.parse(match[1]!);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
