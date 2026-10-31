import { describe, expect, it, mock } from "bun:test";

/** `startWebJobs` hands the review loop a getter, so a config reload reaches it. */

let passed: unknown;
mock.module(new URL("../src/services/skill-learning/web-review.js", import.meta.url).href, () => ({
  startWebSkillReview: (arg: unknown) => {
    passed = arg;
  },
}));

describe("web jobs", () => {
  it("passes a getter that returns the CONFIG after a reload", async () => {
    const { startWebJobs } = await import("../src/services/web-jobs.js");
    await startWebJobs();
    const config = await import("../src/config.js");
    config.initConfig("/nonexistent-project-for-web-jobs");
    expect(typeof passed).toBe("function");
    expect((passed as () => unknown)()).toBe(config.CONFIG);
  });
});
