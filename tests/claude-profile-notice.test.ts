import { beforeEach, describe, expect, it, mock } from "bun:test";

// Claude Code shows the profile notice on a later hook (change unify-profile-learning,
// design D8, task 8.2). The learning pass runs in the web app after a Stop hook, when no
// hook waits for an answer. The web app keeps one pending line and adds it to the
// `systemMessage` of the next `user-prompt-submit` or `session-start` answer whose hook
// asks for user lines. Only the hook's confirmation clears it.

const realLogger = await import("../src/services/logger.js");
mock.module("../src/services/logger.js", () => ({ ...realLogger, log: () => {} }));
const realTags = await import("../src/services/tags.js");
mock.module("../src/services/tags.js", () => ({
  ...realTags,
  getTags: () => ({ user: { userEmail: "me@example.invalid", displayName: "Me", userName: "me" } }),
}));
mock.module("../src/services/user-prompt/profile-catch-up-lease.js", () => ({
  CatchUpLease: class {
    async isActive() {
      return false;
    }
  },
}));
// The retrieval itself is not under test: it adds nothing.
const realContext = await import("../src/importer/claude-hook-context.js");
mock.module("../src/importer/claude-hook-context.js", () => ({
  ...realContext,
  promptContext: async () => "",
  subagentContext: async () => "",
}));

let waiting: string[] = [];
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => waiting.length,
    getPromptsForUserLearning: async (limit: number) =>
      waiting.slice(0, limit).map((id, i) => ({ id, content: `Please refactor module ${i}` })),
    markMultipleAsUserLearningCaptured: async (ids: string[]) => {
      waiting = waiting.filter((id) => !ids.includes(id));
    },
    markForUserLearning: async () => {},
  },
}));
mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    getActiveProfile: async () => null,
    createProfile: async () => "p1",
  },
}));

const { CONFIG } = await import("../src/config.js");
const { profileBackoff } = await import("../src/core/profile-backoff.js");
const { learnClaudeProfile } = await import("../src/importer/claude-profile-learning.js");
const { handleClaudeRetrieve, handleClaudeNoticesShown } =
  await import("../src/importer/claude-hook-api.js");

const PROFILE_KEY = "claude-code-profile-updated";
const profileKey = (keys?: string[]) => keys?.find((key) => key.startsWith(PROFILE_KEY));
const line = (count: number) =>
  `OMMS: User profile updated. Analysed ${count} prompts and updated your profile`;

const model = {
  provider: "stub",
  modelId: "stub",
  async complete() {
    return JSON.stringify({ preferences: [], patterns: [], workflows: [] });
  },
};

/** One Claude Code learning pass over `count` waiting prompts, at an interval of `count`. */
async function learn(count: number): Promise<void> {
  waiting = Array.from({ length: count }, (_, i) => `p${i}`);
  CONFIG.userProfileAnalysisInterval = count;
  await learnClaudeProfile("/workspace", () => model as never);
}

const ask = (event: string, notices = true) =>
  handleClaudeRetrieve({
    event,
    session_id: "s-1",
    cwd: "/workspace",
    ...(event === "user-prompt-submit" ? { prompt: "next question" } : {}),
    ...(event === "session-start" ? { source: "startup" } : {}),
    ...(notices ? { notices: true } : {}),
  });

beforeEach(async () => {
  // Clear a line left by an earlier test: confirm the key the next hook would carry.
  handleClaudeNoticesShown({ keys: (await ask("user-prompt-submit")).noticeKeys });
  profileBackoff.recordSuccess();
  Object.assign(CONFIG, {
    showUserProfileToasts: true,
    userProfileWithoutEmail: "learn",
    userProfileDuringCatchUp: "learn",
    userProfilePromptDetail: "full",
    userProfileDecayBeforeMerge: false,
    userProfileValidationEnabled: false,
    userProfileAutoCleanupEnabled: false,
  });
});

describe("the Claude Code profile notice", () => {
  it("shows on the next prompt, beside the context and never in it", async () => {
    await learn(10);
    const reply = await ask("user-prompt-submit");
    expect(reply.systemMessage).toBe(line(10));
    expect(reply.noticeKeys).toHaveLength(1);
    expect(profileKey(reply.noticeKeys)).toBeDefined();
    expect(reply.additionalContext).not.toContain("User profile updated");
  });

  it("shows on a session start that asks for user lines", async () => {
    await learn(5);
    const reply = await ask("session-start");
    expect(reply.systemMessage?.split("\n")).toContain(line(5));
    expect(profileKey(reply.noticeKeys)).toBeDefined();
  });

  it("shows one line, for the newer pass, when two passes save before the next prompt", async () => {
    await learn(5);
    await learn(7);
    const reply = await ask("user-prompt-submit");
    expect(reply.systemMessage).toBe(line(7));
  });

  it("shows nothing when notices are off", async () => {
    CONFIG.showUserProfileToasts = false;
    await learn(5);
    const reply = await ask("user-prompt-submit");
    expect(reply.systemMessage).toBeUndefined();
    expect(reply.noticeKeys).toBeUndefined();
  });

  it("stays pending through a subagent hook and an older hook that does not ask", async () => {
    await learn(5);
    const subagent = await ask("subagent-start");
    expect(subagent.systemMessage).toBeUndefined();
    expect(subagent.noticeKeys).toBeUndefined();
    const older = await ask("user-prompt-submit", false);
    expect(older.systemMessage).toBeUndefined();
    expect((await ask("user-prompt-submit")).systemMessage).toBe(line(5));
  });

  it("counts as shown only after the hook confirms it", async () => {
    await learn(5);
    const first = await ask("user-prompt-submit");
    expect(first.systemMessage).toBe(line(5));
    // A lost reply: the hook never confirmed, so the next prompt shows the line again.
    const again = await ask("user-prompt-submit");
    expect(again.systemMessage).toBe(first.systemMessage);
    handleClaudeNoticesShown({ keys: again.noticeKeys });
    const after = await ask("user-prompt-submit");
    expect(after.systemMessage).toBeUndefined();
  });

  it("a confirmation for an older line does not clear a newer one", async () => {
    await learn(5);
    const older = await ask("user-prompt-submit");
    await learn(7);
    // The hook that showed the older line confirms after the newer pass has saved.
    handleClaudeNoticesShown({ keys: older.noticeKeys });
    const next = await ask("user-prompt-submit");
    expect(next.systemMessage).toBe(line(7));
    handleClaudeNoticesShown({ keys: next.noticeKeys });
    expect((await ask("user-prompt-submit")).systemMessage).toBeUndefined();
  });

  it("ignores a confirmation without the profile key", async () => {
    await learn(5);
    handleClaudeNoticesShown({ keys: ["claude-code"] });
    expect((await ask("user-prompt-submit")).systemMessage).toBe(line(5));
  });
});
