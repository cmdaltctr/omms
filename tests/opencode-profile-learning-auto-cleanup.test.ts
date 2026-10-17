import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// After an OpenCode learning pass saves, the shared automatic cleanup starts when the count
// of analysed prompts passes a multiple of the interval. Learning does not wait for it and
// does not fail when it fails.

const tempDirs: string[] = [];

const url = (path: string) => new URL(path, import.meta.url).href;

type Scenario = {
  previous: number;
  enabled?: boolean;
  interval?: number;
  cleanup: "pending" | "rejects" | "missing-model";
};

function runScenario({ previous, enabled = true, interval = 100, cleanup }: Scenario) {
  const dir = mkdtempSync(join(tmpdir(), "omms-opencode-auto-cleanup-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const prompts = Array.from({ length: 5 }, (_, i) => ({
  id: "prompt-" + i, sessionId: "s", messageId: "m" + i, projectPath: "/workspace",
  content: "Prompt " + i, createdAt: i + 1, captured: false, user_learning_captured: false, capture_attempts: 0,
}));
const marked = [];
const started = [];

mock.module(${JSON.stringify(url("../src/config.js"))}, () => ({
  refreshConfigIfChanged: () => {},
  CONFIG: {
    autoCaptureProviderStatus: { ready: true, mode: "opencode", issues: [] },
    userProfileAnalysisInterval: 5,
    userProfileMaxContextBytes: 32768,
    opencodeProvider: "opencode-go",
    opencodeModel: "deepseek-v4-flash",
    userProfileValidationEnabled: false,
    showUserProfileToasts: false,
    userProfileAutoCleanupEnabled: ${enabled},
    userProfileAutoCleanupInterval: ${interval},
  },
}));
mock.module(${JSON.stringify(url("../src/services/tags.js"))}, () => ({
  getTags: () => ({ user: { tag: "t", displayName: "T", userName: "t", userEmail: "t@example.com" } }),
}));
mock.module(${JSON.stringify(url("../src/services/user-prompt/user-prompt-manager.js"))}, () => ({
  userPromptManager: {
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => 5,
    getPromptsForUserLearning: async () => prompts,
    markMultipleAsUserLearningCaptured: async (ids) => { marked.push(...ids); },
  },
}));
const empty = JSON.stringify({ preferences: [], patterns: [], workflows: [] });
mock.module(${JSON.stringify(url("../src/services/user-profile/user-profile-manager.js"))}, () => ({
  userProfileManager: {
    getActiveProfile: async () => ({ id: "p1", version: 7, profileData: empty, totalPromptsAnalyzed: ${previous} }),
    createProfile: async () => ({}),
    mergeProfileData: async () => ({ preferences: [], patterns: [], workflows: [] }),
    updateProfile: async () => true,
    decayInMemory: (d) => ({ data: d }),
    syncConfidence: () => {},
  },
}));
mock.module(${JSON.stringify(url("../src/services/logger.js"))}, () => ({ log: () => {} }));
mock.module(${JSON.stringify(url("../src/adapters/opencode/opencode-provider-loader.js"))}, () => ({
  loadOpencodeProvider: async () => ({
    generateStructuredOutput: async () => ({ preferences: [], patterns: [], workflows: [] }),
  }),
}));
mock.module(${JSON.stringify(url("../src/adapters/opencode/profile-llm-client.js"))}, () => ({
  getOpenCodeClient: async () => ({}),
}));
mock.module(${JSON.stringify(url("../src/services/user-profile/auto-cleanup.js"))}, () => ({
  startAutoProfileCleanup: (userId) => {
    started.push(userId);
    if (${JSON.stringify(cleanup)} === "rejects") return Promise.reject(new Error("boom"));
    return new Promise(() => {});
  },
}));

const { performUserProfileLearning } = await import(${JSON.stringify(url("../src/adapters/opencode/profile-learning.js"))});
const { profileBackoff } = await import(${JSON.stringify(url("../src/core/profile-backoff.js"))});
await performUserProfileLearning({}, "/workspace");
await new Promise((resolve) => setTimeout(resolve, 50));
console.log(JSON.stringify({ started, marked: marked.length, canRun: profileBackoff.canRun() }));
process.exit(0);
`;
  writeFileSync(scriptPath, script, "utf8");
  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const line = Buffer.from(result.stdout)
    .toString("utf8")
    .split("\n")
    .reverse()
    .find((entry) => entry.trim().startsWith("{"));
  return {
    exitCode: result.exitCode,
    stderr: Buffer.from(result.stderr).toString("utf8").trim(),
    parsed: line
      ? (JSON.parse(line) as { started: string[]; marked: number; canRun: boolean })
      : null,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("OpenCode automatic cleanup after learning", () => {
  it("starts one run when the pass crosses the interval, and does not wait for it", () => {
    const result = runScenario({ previous: 95, cleanup: "pending" });
    expect(result.exitCode).toBe(0);
    expect(result.parsed?.started).toEqual(["t@example.com"]);
    expect(result.parsed?.marked).toBe(5);
    expect(result.parsed?.canRun).toBe(true);
  });

  it("starts no run when the pass does not cross the interval", () => {
    const result = runScenario({ previous: 90, cleanup: "pending" });
    expect(result.parsed?.started).toEqual([]);
    expect(result.parsed?.marked).toBe(5);
  });

  it("starts no run when the setting is off", () => {
    const result = runScenario({ previous: 95, enabled: false, cleanup: "pending" });
    expect(result.parsed?.started).toEqual([]);
  });

  it("does not fail learning when the run rejects", () => {
    const result = runScenario({ previous: 95, cleanup: "rejects" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed?.started).toEqual(["t@example.com"]);
    expect(result.parsed?.marked).toBe(5);
    expect(result.parsed?.canRun).toBe(true);
  });
});
