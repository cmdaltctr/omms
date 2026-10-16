import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// OpenCode learning saves with the version it read. When a save meets a newer version, it
// reloads the profile, merges again and saves with the newer version. After the last
// attempt it keeps the prompts and starts the profile backoff.

const tempDirs: string[] = [];

const url = (path: string) => new URL(path, import.meta.url).href;

function runScenario(failedSaves: number) {
  const dir = mkdtempSync(join(tmpdir(), "omms-opencode-conflict-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const prompts = Array.from({ length: 5 }, (_, i) => ({
  id: "prompt-" + i, sessionId: "s", messageId: "m" + i, projectPath: "/workspace",
  content: "Prompt " + i, createdAt: i + 1, captured: false, user_learning_captured: false, capture_attempts: 0,
}));
const saves = [];
const marked = [];
let reads = 0;
let failed = 0;

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
    // Every read finds a newer version, as if another writer saved in between.
    getActiveProfile: async () => ({ id: "p1", version: 7 + reads++, profileData: empty, totalPromptsAnalyzed: 0 }),
    createProfile: async () => ({}),
    mergeProfileData: async () => ({ preferences: [], patterns: [], workflows: [] }),
    updateProfile: async (id, data, count, summary, expectedVersion) => {
      saves.push(expectedVersion);
      if (failed < ${failedSaves}) { failed++; return false; }
      return true;
    },
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

const { performUserProfileLearning } = await import(${JSON.stringify(url("../src/adapters/opencode/profile-learning.js"))});
const { profileBackoff } = await import(${JSON.stringify(url("../src/core/profile-backoff.js"))});
await performUserProfileLearning({}, "/workspace");
console.log(JSON.stringify({ saves, marked: marked.length, canRun: profileBackoff.canRun() }));
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
      ? (JSON.parse(line) as { saves: number[]; marked: number; canRun: boolean })
      : null,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("OpenCode profile learning save conflicts", () => {
  it("saves with the version it read and marks the prompts when the first save succeeds", () => {
    const result = runScenario(0);
    expect(result.exitCode).toBe(0);
    expect(result.parsed?.saves).toEqual([7]);
    expect(result.parsed?.marked).toBe(5);
    expect(result.parsed?.canRun).toBe(true);
  });

  it("reloads the profile and saves with the newer version after one conflict", () => {
    const result = runScenario(1);
    expect(result.exitCode).toBe(0);
    expect(result.parsed?.saves).toEqual([7, 8]);
    expect(result.parsed?.marked).toBe(5);
  });

  it("keeps the prompts and starts the backoff after three conflicts", () => {
    const result = runScenario(99);
    expect(result.exitCode).toBe(0);
    expect(result.parsed?.saves).toEqual([7, 8, 9]);
    expect(result.parsed?.marked).toBe(0);
    expect(result.parsed?.canRun).toBe(false);
  });
});
