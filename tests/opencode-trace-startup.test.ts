import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const url = (path: string) => new URL(path, import.meta.url).href;

describe("OpenCode plugin startup", () => {
  it("removes expired trace files even with tracing off", () => {
    const dir = mkdtempSync(join(tmpdir(), "omms-opencode-traces-"));
    tempDirs.push(dir);
    const traces = join(dir, "traces");
    mkdirSync(traces, { recursive: true });
    const expired = join(traces, "capture-2000-01-01.jsonl");
    writeFileSync(expired, "{}\n");

    const scriptPath = join(dir, "scenario.mjs");
    writeFileSync(
      scriptPath,
      `
import { mock } from "bun:test";
mock.module(${JSON.stringify(url("../src/services/client.js"))}, () => ({
  memoryClient: { warmup: async () => {}, isReady: async () => true, close() {} },
}));
mock.module(${JSON.stringify(url("../src/config.js"))}, () => ({
  CONFIG: { autoCaptureLanguage: "auto", memory: { defaultScope: "project" }, captureTrace: false },
  initConfig: () => {},
  initConfigWithLegacyMigration: () => {},
  getExplicitContainerTagPrefix: () => undefined,
  isConfigured: () => false,
}));
mock.module(${JSON.stringify(url("../src/services/tags.js"))}, () => ({
  getTags: () => ({ project: { tag: "project-tag" }, user: { userEmail: "u@example.com" } }),
}));
mock.module(${JSON.stringify(url("../src/services/auto-capture.js"))}, () => ({
  performAutoCapture: async () => {},
}));
mock.module(${JSON.stringify(url("../src/adapters/opencode/profile-learning.js"))}, () => ({
  performUserProfileLearning: async () => {},
}));
mock.module(${JSON.stringify(url("../src/services/user-prompt/user-prompt-manager.js"))}, () => ({
  userPromptManager: { savePrompt() {} },
}));
mock.module(${JSON.stringify(url("../src/services/language-detector.js"))}, () => ({
  getLanguageName: () => "English",
}));
mock.module(${JSON.stringify(url("../src/services/logger.js"))}, () => ({ log: () => {} }));
const { OmmsPlugin } = await import(${JSON.stringify(url("../src/index.js"))});
await OmmsPlugin({ directory: "/workspace", client: {} });
`
    );

    const result = Bun.spawnSync({
      cmd: [process.execPath, scriptPath],
      env: { ...process.env, OMMS_LOG_FILE: join(dir, "omms.log") },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(Buffer.from(result.stderr).toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(existsSync(expired)).toBe(false);
  });
});
