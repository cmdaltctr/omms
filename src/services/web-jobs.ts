import type { WebSkillReviewConfig } from "./skill-learning/web-review.js";

/**
 * Background jobs of the web app that owns the port. That process serves the
 * Claude Code hooks, so web-server.ts also starts their capture retries next to
 * this call (the importer import must stay in web-server.ts). Kept out of
 * web-server.ts, which sits at its size ceiling.
 *
 * A config reload replaces CONFIG, so the caller passes a getter that reads the
 * live value on every tick.
 */
export async function startWebJobs(getConfig: () => WebSkillReviewConfig): Promise<void> {
  const { startWebSkillReview } = await import("./skill-learning/web-review.js");
  startWebSkillReview(getConfig);
}
