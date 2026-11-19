import { analyzeProfile, type ModelPort } from "../profile-analysis.js";
import { profileBackoff, profileCatchUpLock, recordProfileFailure } from "../profile-backoff.js";
import type { ProfileFailureCode } from "../profile-failure.js";
import { log } from "../../services/logger.js";
import { getTags } from "../../services/tags.js";
import { shouldStartAutoCleanup } from "../../services/user-profile/auto-cleanup-trigger.js";
import type { AutoCleanupOptions } from "../../services/user-profile/auto-cleanup.js";
import type { MemoryModelSettings } from "../../services/user-profile/memory-model-settings.js";
import type { UserProfile, UserProfileData } from "../../services/user-profile/types.js";
import { HOST_INFO, type MemoryHost } from "../../shared/hosts.js";
import { buildProfileLearningInput } from "./model-input.js";
import type { ProfileLearningSettings } from "./settings.js";
import { applyValidations, buildValidationTask, type ValidationTask } from "./validation.js";

// The one live profile learning pass for every host (change unify-profile-learning, design D1).
// Adapters keep the trigger, the model and the notice display. Everything else is here.

/** The config a pass reads. The adapter passes `CONFIG`; this module never imports it. */
export interface ProfileLearningConfig extends ProfileLearningSettings, MemoryModelSettings {
  userProfileAnalysisInterval?: number;
  userProfileMaxContextBytes?: number;
  userProfileAutoCleanupEnabled?: boolean;
  userProfileAutoCleanupInterval?: number;
}

export interface ProfileLearningNotice {
  title: string;
  message: string;
  variant: "success" | "warning" | "error";
}

export interface ProfileLearningPassInput {
  host: MemoryHost;
  directory: string;
  config: ProfileLearningConfig;
  /** The learning model. Null skips the pass and leaves the prompts waiting. */
  model: () => ModelPort | null | Promise<ModelPort | null>;
  notify?: (notice: ProfileLearningNotice) => void | Promise<void>;
  /** The model of the automatic cleanup that the pass starts. Absent means the external API. */
  cleanupModel?: AutoCleanupOptions["resolveModel"];
}

export interface ProfileLearningPassResult {
  outcome: "saved" | "skipped" | "failed";
  reason?: ProfileFailureCode;
}

/** The profile id when no user email is known and the setting says `learn`. */
export const UNKNOWN_PROFILE_ID = "unknown";

const DEFAULT_MAX_CONTEXT_BYTES = 32768;

type Stores = Awaited<ReturnType<typeof loadStores>>;
type ProfileStore = Stores["userProfileManager"];

async function loadStores() {
  const [{ userPromptManager }, { userProfileManager }] = await Promise.all([
    import("../../services/user-prompt/user-prompt-manager.js"),
    import("../../services/user-profile/user-profile-manager.js"),
  ]);
  return { userPromptManager, userProfileManager };
}

// One pass at a time in a process, as each host loop had before.
let running = false;

/**
 * Runs one live learning pass: skip trivial prompts, claim a batch, build the model input,
 * call the model, check the reply, merge, save, mark the prompts learned, start the
 * automatic cleanup when due, and send the notice. Never throws. A failure logs one record,
 * starts the 10-minute wait and releases the claimed prompts.
 */
export async function runProfileLearningPass(
  input: ProfileLearningPassInput
): Promise<ProfileLearningPassResult> {
  if (running || !profileBackoff.canRun()) return { outcome: "skipped" };
  const interval = input.config.userProfileAnalysisInterval ?? 0;
  if (!(interval > 0)) return { outcome: "skipped" };
  running = true;
  try {
    return await learn(input, interval);
  } finally {
    running = false;
  }
}

async function learn(
  input: ProfileLearningPassInput,
  interval: number
): Promise<ProfileLearningPassResult> {
  const { host, config } = input;
  const label = HOST_INFO[host].label;
  let claimed: string[] = [];
  let stores: Stores | null = null;
  try {
    if (config.userProfileDuringCatchUp === "pause" && (await catchUpRunning())) {
      log("profile learning: paused during a catch-up run", { host });
      return { outcome: "skipped" };
    }
    stores = await loadStores();
    const { userPromptManager, userProfileManager } = stores;
    await userPromptManager.skipTrivialPromptsForLearning();
    if ((await userPromptManager.countUnanalyzedForUserLearning()) < interval) {
      return { outcome: "skipped" };
    }
    const user = getTags(input.directory).user;
    if (!user.userEmail && config.userProfileWithoutEmail === "skip") {
      log("profile learning skipped", { host, code: "no-user-email" }, "warn");
      return { outcome: "skipped" };
    }
    const userId = user.userEmail || UNKNOWN_PROFILE_ID;
    const model = await input.model();
    if (!model) {
      log("profile learning skipped", { host, code: "no-model" }, "warn");
      return { outcome: "skipped" };
    }
    const batch = await userPromptManager.getPromptsForUserLearning(interval, {
      recentFirst: true,
      claim: true,
    });
    claimed = batch.map((prompt) => prompt.id);
    // Another run holds the waiting prompts.
    if (batch.length === 0) return { outcome: "skipped" };

    const read = await userProfileManager.getActiveProfile(userId);
    const startedAt = Date.now();
    const fade = (data: UserProfileData) =>
      config.userProfileDecayBeforeMerge ? fadeProfile(userProfileManager, data, startedAt) : data;
    const existing = read ? withData(read, fade(JSON.parse(read.profileData))) : null;
    const validation =
      existing && config.userProfileValidationEnabled
        ? buildValidationTask(JSON.parse(existing.profileData))
        : null;
    const modelInput = buildProfileLearningInput({
      detail: config.userProfilePromptDetail,
      prompts: batch,
      existingProfile: existing,
      validationTask: validation?.task,
      maxBytes: config.userProfileMaxContextBytes ?? DEFAULT_MAX_CONTEXT_BYTES,
    });
    const analysis = await analyzeProfile(
      model,
      modelInput,
      existing ? { id: existing.id, profileData: existing.profileData } : null
    );

    const summary = `${label} analysis of ${batch.length} prompts`;
    if (existing) {
      const { saveMergedProfile } = await import("../../services/user-profile/merge-and-save.js");
      const saved = await saveMergedProfile(
        userProfileManager,
        existing,
        analysis,
        batch.length,
        summary,
        {
          beforeMerge: fade,
          beforeSave: validation
            ? (merged, profileId) =>
                verdicts(userProfileManager, merged, analysis.raw, profileId, validation)
            : undefined,
        }
      );
      if (!saved) throw new Error("Profile update conflict");
    } else {
      await userProfileManager.createProfile(
        userId,
        user.displayName || userId,
        user.userName || userId,
        user.userEmail || userId,
        analysis.raw,
        batch.length
      );
    }
    // The profile is saved, so the claim is not released if the mark fails: a release would
    // make the next pass learn this batch a second time.
    const marked = claimed;
    claimed = [];
    await markLearned(userPromptManager, marked, host);
    profileBackoff.recordSuccess();
    log("profile learning finished", { host, prompts: batch.length, hadExisting: !!existing });

    startCleanupWhenDue(input, userId, read?.totalPromptsAnalyzed ?? 0, batch.length);
    if (config.showUserProfileToasts) {
      // A notice can throw at once (a replaced Pi session); the save already happened.
      try {
        await input.notify?.({
          title: "User profile updated",
          message: `Analysed ${batch.length} prompts and updated your profile`,
          variant: "success",
        });
      } catch {
        // A failed notice does not fail a saved pass.
      }
    }
    return { outcome: "saved" };
  } catch (error) {
    if (claimed.length > 0 && stores) {
      await stores.userPromptManager.markForUserLearning(claimed).catch(() => {});
    }
    const reason = recordProfileFailure(host, `${label} profile learning failed`, error);
    return { outcome: "failed", reason };
  }
}

const MARK_ATTEMPTS = 3;
const MARK_RETRY_MS = 100;

/**
 * Marks the saved batch as learned. A storage error is tried again; when every try fails,
 * the claim runs out by itself and the pass stays saved. The log holds a count only.
 */
async function markLearned(
  store: Stores["userPromptManager"],
  ids: string[],
  host: MemoryHost
): Promise<void> {
  for (let attempt = 1; attempt <= MARK_ATTEMPTS; attempt++) {
    try {
      await store.markMultipleAsUserLearningCaptured(ids);
      return;
    } catch {
      if (attempt < MARK_ATTEMPTS) await new Promise((r) => setTimeout(r, MARK_RETRY_MS * attempt));
    }
  }
  log("profile learning: prompts not marked as learned", { host, prompts: ids.length }, "error");
}

/** A catch-up run in this process, or one that holds the run record in any process. */
async function catchUpRunning(): Promise<boolean> {
  if (profileCatchUpLock.isActive()) return true;
  const { CatchUpLease } = await import("../../services/user-prompt/profile-catch-up-lease.js");
  return new CatchUpLease().isActive().catch(() => false);
}

function withData(profile: UserProfile, data: UserProfileData): UserProfile {
  return { ...profile, profileData: JSON.stringify(data) };
}

/**
 * Decay, as the OpenCode loop applied it before this change: fade old items, and confirm
 * items that waited for validation since before the pass started.
 */
function fadeProfile(store: ProfileStore, data: UserProfileData, startedAt: number) {
  const { data: decayed } = store.decayInMemory(data);
  for (const item of [...decayed.preferences, ...decayed.patterns, ...decayed.workflows]) {
    if (item.pendingValidation && (item.lastSeen || 0) < startedAt) {
      item.pendingValidation = false;
      item.alpha = (item.alpha || 1) + 1;
      store.syncConfidence(item);
    }
  }
  return decayed;
}

function verdicts(
  store: ProfileStore,
  merged: UserProfileData,
  raw: UserProfileData,
  profileId: string,
  validation: ValidationTask
): Promise<string | null> {
  return applyValidations(store, merged, raw, profileId, validation.keys);
}

/** In the background: a long cleanup must not hold the pass, and its failure must not fail it. */
function startCleanupWhenDue(
  input: ProfileLearningPassInput,
  userId: string,
  previous: number,
  added: number
): void {
  const settings = {
    enabled: input.config.userProfileAutoCleanupEnabled,
    interval: input.config.userProfileAutoCleanupInterval,
  };
  if (!shouldStartAutoCleanup(previous, added, settings)) return;
  void import("../../services/user-profile/auto-cleanup.js")
    .then(({ startAutoProfileCleanup }) =>
      startAutoProfileCleanup(userId, {
        settings: input.config,
        resolveModel: input.cleanupModel,
      })
    )
    .catch(() => {});
}
