import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Task 4.4: OpenCode profile-learning input must obey userProfileMaxContextBytes
// as a UTF-8 byte limit with the truncation marker inside the ceiling. The old
// limiter compared JavaScript characters and appended the marker outside the
// limit, so multibyte input (Chinese, Arabic, emoji) passed through oversized
// and surrogate pairs could be split at the cut.

const tempDirs: string[] = [];

const learningUrl = new URL("../src/adapters/opencode/profile-learning.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const promptManagerUrl = new URL(
  "../src/services/user-prompt/user-prompt-manager.js",
  import.meta.url
).href;
const profileManagerUrl = new URL(
  "../src/services/user-profile/user-profile-manager.js",
  import.meta.url
).href;
const opencodeProviderLoaderUrl = new URL(
  "../src/adapters/opencode/opencode-provider-loader.js",
  import.meta.url
).href;
const profileLlmClientUrl = new URL(
  "../src/adapters/opencode/profile-llm-client.js",
  import.meta.url
).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;

const MARKER = "[... context truncated to userProfileMaxContextBytes ...]";

/** A lone high or low surrogate: a multi-byte character split at the cut. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

interface ScenarioResult {
  exitCode: number;
  stderr: string;
  parsed: {
    error: string | null;
    userPrompt: string | null;
    promptsAfter: Array<{ content: string }> | null;
  } | null;
}

function runScenario(options: {
  userProfileMaxContextBytes: number;
  prompts: string[];
}): ScenarioResult {
  const dir = mkdtempSync(join(tmpdir(), "omms-profile-bytes-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const prompts = ${JSON.stringify(options.prompts)}.map((content, i) => ({
  id: \`prompt-\${i}\`,
  sessionId: "session-1",
  messageId: \`msg-\${i}\`,
  projectPath: "/workspace",
  content,
  createdAt: i + 1,
  captured: false,
  user_learning_captured: false,
  capture_attempts: 0,
}));

let capturedUserPrompt = null;

mock.module(${JSON.stringify(configUrl)}, () => ({
  refreshConfigIfChanged: () => {},
  CONFIG: {
    autoCaptureProviderStatus: { ready: true, mode: "opencode", issues: [] },
    userProfileAnalysisInterval: 5,
    userProfileMaxContextBytes: ${options.userProfileMaxContextBytes},
    opencodeProvider: "opencode-go",
    opencodeModel: "deepseek-v4-flash",
    userProfileValidationEnabled: false,
    showUserProfileToasts: false,
  },
}));

mock.module(${JSON.stringify(tagsUrl)}, () => ({
  getTags: () => ({
    user: {
      tag: "opencode_user_test",
      displayName: "Test User",
      userName: "tester",
      userEmail: "test@example.com",
    },
  }),
}));

mock.module(${JSON.stringify(promptManagerUrl)}, () => ({
  userPromptManager: {
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => 10,
    getPromptsForUserLearning: async () => prompts,
    markMultipleAsUserLearningCaptured: async () => {},
  },
}));

mock.module(${JSON.stringify(profileManagerUrl)}, () => ({
  userProfileManager: {
    getActiveProfile: async () => null,
    createProfile: async () => ({}),
    mergeProfileData: async () => ({}),
    updateProfile: async () => true,
    decayInMemory: (d) => ({ data: d }),
    syncConfidence: () => {},
  },
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));

mock.module(${JSON.stringify(opencodeProviderLoaderUrl)}, () => ({
  loadOpencodeProvider: async () => ({
    generateStructuredOutput: async (request) => {
      capturedUserPrompt = request.userPrompt;
      return { preferences: [], patterns: [], workflows: [] };
    },
  }),
}));

mock.module(${JSON.stringify(profileLlmClientUrl)}, () => ({
  getOpenCodeClient: async () => ({}),
}));

try {
  const { performUserProfileLearning } = await import(${JSON.stringify(learningUrl)});
  await performUserProfileLearning({}, "/workspace");
  console.log(JSON.stringify({
    error: null,
    userPrompt: capturedUserPrompt,
    promptsAfter: prompts.map((p) => ({ content: p.content })),
  }));
} catch (e) {
  console.log(JSON.stringify({
    error: e?.message ?? String(e),
    userPrompt: capturedUserPrompt,
    promptsAfter: prompts.map((p) => ({ content: p.content })),
  }));
}
process.exit(0);
`;

  writeFileSync(scriptPath, script, "utf8");
  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();
  const jsonLine = stdout
    .split("\n")
    .reverse()
    .find((line) => line.trim().startsWith("{"));

  return {
    exitCode: result.exitCode,
    stderr,
    parsed: jsonLine ? JSON.parse(jsonLine) : null,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** Mixed Chinese, Arabic, and emoji text: 3-4 UTF-8 bytes per character. */
function multibytePrompt(index: number): string {
  return (
    `${index}. 用户偏好简体中文回复并且遵循项目的中文注释规范 ` +
    `يفضّل المستخدم الرد بالعربية في التوثيق ` +
    "🚀🎉✨🚀🎉✨"
  );
}

describe("OpenCode profile-learning input byte limit (memory-context-controls 4.4)", () => {
  it("bounds multibyte input by UTF-8 bytes even when the character count fits", () => {
    // Fewer JavaScript characters than the ceiling, more UTF-8 bytes than it.
    const prompts = Array.from({ length: 20 }, (_, i) => multibytePrompt(i + 1));
    const result = runScenario({ userProfileMaxContextBytes: 5000, prompts });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed?.error).toBeNull();
    expect(result.parsed?.userPrompt).toBeTruthy();

    const bytes = Buffer.byteLength(result.parsed!.userPrompt!, "utf8");
    expect(bytes).toBeLessThanOrEqual(5000);
  });

  it("keeps the truncation marker inside the byte ceiling", () => {
    // Both the character count and the byte count exceed the ceiling.
    const prompts = [
      `${1}. ${"🚀".repeat(2000)}`,
      ...Array.from({ length: 12 }, (_, i) => multibytePrompt(i + 2)),
    ];
    const result = runScenario({ userProfileMaxContextBytes: 4096, prompts });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed?.error).toBeNull();

    const userPrompt = result.parsed!.userPrompt!;
    const bytes = Buffer.byteLength(userPrompt, "utf8");
    expect(userPrompt).toContain(MARKER);
    expect(bytes).toBeLessThanOrEqual(4096);
  });

  it("never splits a Unicode character at the cut", () => {
    // The emoji run guarantees the old character cut lands inside a surrogate pair.
    const prompts = [
      `${1}. ${"🚀".repeat(2000)}`,
      ...Array.from({ length: 12 }, (_, i) => multibytePrompt(i + 2)),
    ];
    const result = runScenario({ userProfileMaxContextBytes: 4096, prompts });

    expect(result.exitCode).toBe(0);
    expect(result.parsed?.error).toBeNull();

    const userPrompt = result.parsed!.userPrompt!;
    expect(userPrompt).not.toMatch(LONE_SURROGATE);
    expect(userPrompt).not.toContain("\uFFFD");
  });

  it("leaves input that already fits unchanged", () => {
    const prompts = [
      "Fix the login timeout",
      "Use British spelling in docs",
      "Prefer bun over npm",
    ];
    const result = runScenario({ userProfileMaxContextBytes: 32768, prompts });

    expect(result.exitCode).toBe(0);
    expect(result.parsed?.error).toBeNull();

    const userPrompt = result.parsed!.userPrompt!;
    expect(userPrompt).not.toContain(MARKER);
    expect(userPrompt).toContain("Fix the login timeout");
    expect(userPrompt).toContain("Prefer bun over npm");
  });

  it("does not change the stored prompts", () => {
    const prompts = Array.from({ length: 20 }, (_, i) => multibytePrompt(i + 1));
    const result = runScenario({ userProfileMaxContextBytes: 5000, prompts });

    expect(result.exitCode).toBe(0);
    expect(result.parsed?.promptsAfter).toEqual(prompts.map((content) => ({ content })));
  });
});
