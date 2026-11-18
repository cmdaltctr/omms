import { CONFIG, refreshConfigIfChanged } from "../config.js";
import type { ModelPort } from "../core/profile-analysis.js";
import { setPendingProfileNotice } from "./claude-hook-notices.js";

/**
 * Run one shared learning pass for Claude Code with the external API model
 * (change unify-profile-learning, task 8.1). The pass decides whether enough prompts
 * wait, applies the catch-up setting, and never throws. Its notice waits for the next
 * hook that can show it. The automatic cleanup uses the same model as learning.
 */
export async function learnClaudeProfile(
  directory: string,
  resolveModel: () => ModelPort | Promise<ModelPort>
): Promise<void> {
  refreshConfigIfChanged(directory);
  const { runProfileLearningPass } = await import("../core/profile-learning/pass.js");
  let model: ModelPort | null = null;
  await runProfileLearningPass({
    host: "claude-code",
    directory,
    config: CONFIG,
    model: async () => (model = await resolveModel()),
    notify: setPendingProfileNotice,
    cleanupModel: () => model,
  });
}
