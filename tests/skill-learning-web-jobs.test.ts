import { describe, expect, it, mock } from "bun:test";

/** `startWebJobs` hands the review loop the getter it was given, so a config reload reaches it. */

let passed: (() => unknown) | undefined;
mock.module(new URL("../src/services/skill-learning/web-review.js", import.meta.url).href, () => ({
  startWebSkillReview: (arg: () => unknown) => {
    passed = arg;
  },
}));

describe("web jobs", () => {
  it("passes the getter on, and each call reads the current config", async () => {
    const { startWebJobs } = await import("../src/services/web-jobs.js");
    let current: unknown = { memoryModel: "first" };
    await startWebJobs(() => current as never);
    expect(typeof passed).toBe("function");
    expect(passed!()).toEqual({ memoryModel: "first" });
    current = { memoryModel: "second" };
    expect(passed!()).toEqual({ memoryModel: "second" });
  });
});
