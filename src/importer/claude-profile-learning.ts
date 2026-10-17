import { CONFIG } from "../config.js";
import type { ModelPort } from "../core/profile-analysis.js";
import { log } from "../services/logger.js";
import { getTags } from "../services/tags.js";
import { shouldStartAutoCleanup } from "../services/user-profile/auto-cleanup-trigger.js";

let learning = false;

/**
 * Build or update the user profile from the recorded prompts once there are
 * `userProfileAnalysisInterval` of them. A failure is logged and never
 * blocks capture; the prompts stay for the next pass.
 */
export async function learnClaudeProfile(
  directory: string,
  resolveModel: () => ModelPort | Promise<ModelPort>
): Promise<void> {
  const interval = CONFIG.userProfileAnalysisInterval ?? 0;
  if (!(interval > 0) || learning) return;
  const { profileBackoff, profileCatchUpLock, recordProfileFailure } =
    await import("../core/profile-backoff.js");
  // A catch-up run, here or in a terminal, analyses the same prompts; skip the live pass meanwhile.
  if (!profileBackoff.canRun() || profileCatchUpLock.isActive()) return;
  const { CatchUpLease } = await import("../services/user-prompt/profile-catch-up-lease.js");
  if (await new CatchUpLease().isActive().catch(() => false)) return;
  learning = true;
  try {
    const [{ userPromptManager }, { userProfileManager }, { analyzeProfile }] = await Promise.all([
      import("../services/user-prompt/user-prompt-manager.js"),
      import("../services/user-profile/user-profile-manager.js"),
      import("../core/profile-analysis.js"),
    ]);
    await userPromptManager.skipTrivialPromptsForLearning();
    if ((await userPromptManager.countUnanalyzedForUserLearning()) < interval) return;
    const user = getTags(directory).user;
    if (!user.userEmail) {
      log("Claude Code profile learning skipped", { code: "no-user-email" });
      return;
    }
    const batch = await userPromptManager.getPromptsForUserLearning(interval, {
      recentFirst: true,
    });
    if (batch.length === 0) return;
    const model = await resolveModel();
    const existing = await userProfileManager.getActiveProfile(user.userEmail);
    const context = batch.map((prompt, index) => `${index + 1}. ${prompt.content}`).join("\n");
    const analysis = await analyzeProfile(
      model,
      context,
      existing ? { id: existing.id, profileData: existing.profileData } : null
    );
    if (existing) {
      const { saveMergedProfile } = await import("../services/user-profile/merge-and-save.js");
      const updated = await saveMergedProfile(
        userProfileManager,
        existing,
        analysis,
        batch.length,
        `Claude Code analysis of ${batch.length} prompts`
      );
      if (!updated) throw new Error("Profile update conflict");
    } else {
      await userProfileManager.createProfile(
        user.userEmail,
        user.displayName || user.userEmail,
        user.userName || user.userEmail,
        user.userEmail,
        analysis.raw,
        batch.length
      );
    }
    await userPromptManager.markMultipleAsUserLearningCaptured(batch.map((prompt) => prompt.id));
    profileBackoff.recordSuccess();
    log("Claude Code profile learning finished", {
      prompts: batch.length,
      hadExisting: Boolean(existing),
    });
    if (
      shouldStartAutoCleanup(existing?.totalPromptsAnalyzed ?? 0, batch.length, {
        enabled: CONFIG.userProfileAutoCleanupEnabled,
        interval: CONFIG.userProfileAutoCleanupInterval,
      })
    ) {
      // In the background, with the model learning used: a long run must not hold the pass.
      const userId = user.userEmail;
      void import("../services/user-profile/auto-cleanup.js")
        .then(({ startAutoProfileCleanup }) =>
          startAutoProfileCleanup(userId, { resolveModel: () => model })
        )
        .catch(() => {});
    }
  } catch (error) {
    recordProfileFailure("claude-code", "Claude Code profile learning failed", error);
  } finally {
    learning = false;
  }
}
