/**
 * Background jobs of the web app that owns the port. That process serves the
 * Claude Code hooks, so web-server.ts also starts their capture retries next to
 * this call (the importer import must stay in web-server.ts). Kept out of
 * web-server.ts, which sits at its size ceiling.
 */
export async function startWebJobs(): Promise<void> {
  const [config, { startWebSkillReview }] = await Promise.all([
    import("../config.js"),
    import("./skill-learning/web-review.js"),
  ]);
  // A config reload replaces CONFIG, so read the live module binding each tick.
  startWebSkillReview(() => config.CONFIG);
}
