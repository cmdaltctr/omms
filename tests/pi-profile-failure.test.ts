import { expect, it, mock } from "bun:test";

const logs: Array<{ message: string; data: unknown }> = [];
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: unknown) => logs.push({ message, data: data ?? null }),
}));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({ user: { userEmail: "me@example.invalid", displayName: "Me", userName: "me" } }),
}));
mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: { getActiveProfile: async () => null, createProfile: async () => "p1" },
}));
// Pi reads its recorded prompts from the shared prompt store (change unify-profile-learning).
const waiting = [{ id: "p0", content: "Private prompt about the project", createdAt: 1 }];
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => waiting.length,
    getPromptsForUserLearning: async () => waiting,
    markMultipleAsUserLearningCaptured: async () => {},
    markForUserLearning: async () => {},
  },
}));

const { CONFIG } = await import("../src/config.js");
const { learnPiProfile } = await import("../src/adapters/pi/profile.js");
const { profileBackoff } = await import("../src/core/profile-backoff.js");

it("logs the host and reason code, no prompt text, then waits before the next pass", async () => {
  profileBackoff.recordSuccess();
  let calls = 0;
  const model = {
    provider: "stub",
    modelId: "stub",
    async complete() {
      calls++;
      throw new Error("API request timeout (30000ms) secret prompt text");
    },
  };
  const notices: unknown[] = [];
  Object.assign(CONFIG, { userProfileAnalysisInterval: 1, showErrorToasts: true });
  const input = {
    directory: "/tmp",
    model: () => model,
    notify: (notice: unknown) => void notices.push(notice),
  };
  await learnPiProfile(input);
  await learnPiProfile(input);
  // The shared pass names the host by its label in the log message.
  const failures = logs.filter((entry) => entry.message === "Pi profile learning failed");
  expect(failures).toEqual([
    { message: "Pi profile learning failed", data: { host: "pi", reason: "timeout" } },
  ]);
  expect(JSON.stringify(logs)).not.toContain("Private prompt");
  expect(JSON.stringify(logs)).not.toContain("secret prompt text");
  expect(calls).toBe(1);
  // Pi's failure notice, with the reason code and no prompt or provider text.
  expect(notices).toEqual([
    { title: "Profile Learning Failed", message: "timeout", variant: "error" },
  ]);
  profileBackoff.recordSuccess();
});
