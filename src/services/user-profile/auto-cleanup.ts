import { log } from "../logger.js";
import { AI_CLEANUP_BATCH_SIZE } from "../request-timeouts.js";
import type { ModelPort } from "../../core/profile-analysis.js";
import { addIdsToProfile } from "./ai-cleanup.js";
import { applyCleanupEdits } from "./ai-cleanup-apply.js";
import type { RestoreEntry } from "./ai-cleanup-apply.js";
import {
  cleanupBatch,
  failureReason,
  runInBatches,
  splitIntoBatches,
  type RunInBatchesOptions,
} from "./ai-cleanup-batches.js";
import { deleteAutoCleanup, insertAutoCleanupRecord } from "./auto-cleanup-store.js";
import { applyToNewestProfile, type ProfileEditStore } from "./profile-edit-save.js";
import type { UserProfileData } from "./types.js";

/** A run that would remove or merge away more than this share of its items applies nothing. */
export const AUTO_CLEANUP_MAX_CHANGE_SHARE = 0.25;

export type AutoCleanupOutcome =
  | { status: "applied"; applied: number; skipped: number }
  | { status: "unchanged"; skipped: number }
  | {
      status:
        | "already-running"
        | "no-profile"
        | "too-few-items"
        | "nothing-to-change"
        | "too-many-changes"
        | "conflict"
        | "failed";
    };

export interface AutoCleanupOptions {
  /** A host that has its own model for profile work (Pi) gives it here. */
  resolveModel?: () => ModelPort | null;
  /** Replaces the model call. Tests use this. */
  callBatch?: RunInBatchesOptions["callBatch"];
  batchSize?: number;
  /** The profile store. It defaults to the shared profile manager. */
  store?: ProfileEditStore;
}

// One run at a time in a process. The shared prompt count makes a second host rarely start one.
let running = false;

/**
 * Cleans up the whole profile in the background: duplicates are merged and useless items
 * are removed, in batches, and every change is saved into the newest profile with no
 * review. Before a save it stores a restore record, so the last run can be undone. The
 * caller does not wait for it, and nothing here throws. The log holds counts and fixed
 * codes only, never item text.
 */
export async function startAutoProfileCleanup(
  userId: string,
  options: AutoCleanupOptions = {}
): Promise<AutoCleanupOutcome> {
  if (running) return { status: "already-running" };
  running = true;
  try {
    return await run(userId, options);
  } catch (error) {
    log("auto cleanup: failed", { reason: failureReason(error) }, "error");
    return { status: "failed" };
  } finally {
    running = false;
  }
}

async function run(userId: string, options: AutoCleanupOptions): Promise<AutoCleanupOutcome> {
  const store = options.store ?? (await import("./user-profile-manager.js")).userProfileManager;
  const profile = await store.getActiveProfile(userId);
  if (!profile) return { status: "no-profile" };

  const data = JSON.parse(profile.profileData) as UserProfileData;
  const indexed = addIdsToProfile(data);
  const sent = indexed.preferences.length + indexed.patterns.length + indexed.workflows.length;
  if (sent < 2) return { status: "too-few-items" };

  const batches = splitIntoBatches(indexed, options.batchSize ?? AI_CLEANUP_BATCH_SIZE);
  log("auto cleanup: started", { items: sent, batches: batches.length });
  const callBatch =
    options.callBatch ?? ((batch) => cleanupBatch(batch, options.resolveModel?.() ?? null));
  // Throws when every batch fails; the batches that fail one by one are logged by the runner.
  const result = await runInBatches(batches, { callBatch });
  if (!result) return { status: "failed" };

  const accepted = {
    merged: result.diff.merged.map((merge) => merge.ids),
    removed: result.diff.removed.map((removal) => removal.id),
  };
  const proposed =
    accepted.removed.length + accepted.merged.reduce((count, ids) => count + ids.length - 1, 0);
  if (proposed === 0) {
    log("auto cleanup: finished", { proposed: 0, applied: 0 });
    return { status: "nothing-to-change" };
  }
  if (proposed > AUTO_CLEANUP_MAX_CHANGE_SHARE * sent) {
    log("auto cleanup: skipped", { reason: "too-many-changes", proposed, sent }, "warn");
    return { status: "too-many-changes" };
  }

  const job = { old: data, changes: result.diff, mergedItems: result.mergedItems };
  const outcome = await applyToNewestProfile(
    userId,
    (current) => {
      const applied = applyCleanupEdits(current, job, accepted);
      return {
        profile: applied.profile,
        changed: applied.applied > 0,
        result: { applied: applied.applied, skipped: applied.skipped, restore: applied.restore },
      };
    },
    {
      summary: "Automatic AI cleanup",
      store,
      beforeSave: async (edit, saved) => {
        const id = await insertAutoCleanupRecord(saved.id, {
          promptsAnalyzed: saved.totalPromptsAnalyzed,
          merged: countKind(edit.restore, "merge"),
          removed: countKind(edit.restore, "remove"),
          entries: edit.restore,
        });
        return () => deleteAutoCleanup(id);
      },
    }
  );

  if (outcome.status === "saved") {
    log("auto cleanup: applied", {
      applied: outcome.result.applied,
      skipped: outcome.result.skipped,
      proposed,
    });
    return { status: "applied", applied: outcome.result.applied, skipped: outcome.result.skipped };
  }
  if (outcome.status === "unchanged") {
    log("auto cleanup: finished", { proposed, applied: 0, skipped: outcome.result.skipped });
    return { status: "unchanged", skipped: outcome.result.skipped };
  }
  log("auto cleanup: not saved", { reason: outcome.status });
  return { status: outcome.status };
}

function countKind(entries: RestoreEntry[], kind: RestoreEntry["kind"]): number {
  return entries.filter((entry) => entry.kind === kind).length;
}
