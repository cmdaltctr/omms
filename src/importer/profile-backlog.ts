import { analyzeProfile, type ModelPort } from "../core/profile-analysis.js";
import { profileFailureCode, type ProfileFailureCode } from "../core/profile-failure.js";
import { userProfileManager } from "../services/user-profile/user-profile-manager.js";
import { userPromptManager } from "../services/user-prompt/user-prompt-manager.js";

export type BacklogPromptStore = Pick<
  typeof userPromptManager,
  | "countUnanalyzedForUserLearning"
  | "getPromptsForUserLearning"
  | "markMultipleAsUserLearningCaptured"
> &
  Partial<Pick<typeof userPromptManager, "skipTrivialPromptsForLearning">>;
export type BacklogProfileStore = Pick<
  typeof userProfileManager,
  "getActiveProfile" | "createProfile" | "updateProfile"
>;

export interface DrainProfileBacklogOptions {
  user: { userEmail: string; displayName?: string; userName?: string };
  model: ModelPort;
  batchSize?: number;
  signal?: AbortSignal;
  /** Names the profile change, for example "History import". */
  label?: string;
  promptStore?: BacklogPromptStore;
  profileStore?: BacklogProfileStore;
  onProgress?: (progress: { batchesBuilt: number; remaining: number }) => void;
  /** Called before each batch; a run that no longer owns the catch-up record stops. */
  beforeBatch?: () => Promise<"ok" | "superseded" | "aborted">;
  /** Called after each batch, whatever its outcome. */
  afterBatch?: () => Promise<void>;
}

export interface DrainProfileBacklogReport {
  batchesBuilt: number;
  remaining: number;
  error?: string;
  reason?: ProfileFailureCode;
  /** A newer catch-up run took over before the next batch. */
  superseded?: boolean;
}

/**
 * Analyse every waiting prompt, oldest first, in batches. Each finished batch
 * stays learned; a batch that fails twice stops the run with its reason code,
 * so the next run continues from the prompts still waiting.
 */
export async function drainProfileBacklog(
  options: DrainProfileBacklogOptions
): Promise<DrainProfileBacklogReport> {
  const batchSize = options.batchSize ?? 50;
  const prompts = options.promptStore ?? userPromptManager;
  const profiles = options.profileStore ?? userProfileManager;
  const label = options.label ?? "Profile catch-up";
  const { user, model } = options;
  const report: DrainProfileBacklogReport = { batchesBuilt: 0, remaining: 0 };
  await prompts.skipTrivialPromptsForLearning?.();
  while ((report.remaining = await prompts.countUnanalyzedForUserLearning()) > 0) {
    if (options.signal?.aborted) break;
    const start = (await options.beforeBatch?.()) ?? "ok";
    if (start === "superseded") {
      report.superseded = true;
      break;
    }
    if (start === "aborted") break;
    let outcome: "sent" | "failed" | "empty";
    try {
      outcome = await sendBatch();
    } finally {
      await options.afterBatch?.();
    }
    if (outcome === "failed") return report;
    if (outcome === "empty") break;
    options.onProgress?.({
      batchesBuilt: report.batchesBuilt,
      remaining: await prompts.countUnanalyzedForUserLearning(),
    });
  }
  return report;

  /** One batch with one retry; "failed" stops the run with its reason code. */
  async function sendBatch(): Promise<"sent" | "failed" | "empty"> {
    const batch = await prompts.getPromptsForUserLearning(batchSize);
    if (batch.length === 0) return "empty";
    let succeeded = false;
    for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
      try {
        const existing = await profiles.getActiveProfile(user.userEmail);
        const context = batch.map((item, index) => `${index + 1}. ${item.content}`).join("\n");
        const analysis = await analyzeProfile(
          model,
          context,
          existing ? { id: existing.id, profileData: existing.profileData } : null
        );
        if (existing) {
          if (
            !analysis.merged ||
            !(await profiles.updateProfile(
              existing.id,
              analysis.merged,
              batch.length,
              `${label} of ${batch.length} prompts`
            ))
          )
            throw new Error("Profile update conflict");
        } else {
          await profiles.createProfile(
            user.userEmail,
            user.displayName || user.userEmail,
            user.userName || user.userEmail,
            user.userEmail,
            analysis.raw,
            batch.length
          );
        }
        await prompts.markMultipleAsUserLearningCaptured(batch.map((item) => item.id));
        report.batchesBuilt++;
        succeeded = true;
      } catch (error) {
        if (attempt === 1) {
          report.error = error instanceof Error ? error.message : String(error);
          report.reason = profileFailureCode(error);
          report.remaining = await prompts.countUnanalyzedForUserLearning();
          return "failed";
        }
      }
    }
    return "sent";
  }
}
