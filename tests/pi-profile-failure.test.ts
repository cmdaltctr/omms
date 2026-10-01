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

const { performPiProfileLearning } = await import("../src/adapters/pi/profile.js");
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
  const input = {
    directory: "/tmp",
    prompts: ["Private prompt about the project"],
    resolveProfileModel: () => model,
  };
  await performPiProfileLearning(input);
  await performPiProfileLearning(input);
  const failures = logs.filter((entry) => entry.message === "pi profile learning: aborted");
  expect(failures).toEqual([
    { message: "pi profile learning: aborted", data: { host: "pi", reason: "timeout" } },
  ]);
  expect(JSON.stringify(logs)).not.toContain("Private prompt");
  expect(JSON.stringify(logs)).not.toContain("secret prompt text");
  expect(calls).toBe(1);
  profileBackoff.recordSuccess();
});
