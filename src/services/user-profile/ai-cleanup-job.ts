import { log } from "../logger.js";
import { AI_CLEANUP_BATCH_SIZE } from "../request-timeouts.js";
import type { CleanupDiff } from "./ai-cleanup.js";
import type { CleanupJobResult } from "./ai-cleanup-apply.js";
import {
  cleanupBatch,
  failureReason,
  runInBatches,
  selectForCleanup,
  splitIntoBatches,
  type RunInBatchesOptions,
} from "./ai-cleanup-batches.js";
import type { MemoryModelSettings } from "./memory-model-settings.js";
import { markAiChecked, pruneAiCheckedTo } from "../storage/profiles/ai-checked.js";
import { resettable } from "../spaces/store-handles.js";
import { aiCheckedKeysForIds, aiCheckedKeysOf } from "./ai-cleanup-checked.js";
import type { UserProfileData } from "./types.js";

/**
 * A large AI cleanup takes many minutes, longer than a web request may stay open. The web
 * app therefore runs it as a background job per user, and the dialog polls its state.
 * The job also holds the finished result until Apply. Jobs live in this process only; a
 * restart drops them. The profile is not changed before Apply. When a job finishes, it
 * saves which memories the model looked at and kept (the checked marks).
 */
export type AiCleanupJobStatus =
  | { state: "running"; done: number; total: number; failed: number }
  | {
      state: "done";
      result: {
        old: UserProfileData;
        changes: CleanupDiff;
        failedBatches: number;
        failedItems: number;
      };
    }
  | { state: "failed"; error: string };

export interface AiCleanupJobView {
  id: string;
  startedAt: number;
  selection: string[];
  status: AiCleanupJobStatus;
}

interface AiCleanupJob extends AiCleanupJobView {
  finishedAt?: number;
  stopped: boolean;
  mergedItems: Record<string, unknown>;
}

export interface AiCleanupJobInput {
  /** The profile as the dialog lists it, so item ids match. */
  profileData: UserProfileData;
  /** An empty or missing selection means every item. */
  includeIds?: string[];
  /** The profile the checked marks belong to. Without it, the job saves no marks. */
  profileId?: string;
  /** Reads the newest profile, so marks that match no memory now can be deleted. */
  loadProfile?: () => Promise<UserProfileData | null>;
}

export interface AiCleanupJobDeps {
  callBatch?: RunInBatchesOptions["callBatch"];
  batchSize?: number;
  now?: () => number;
}

/** A finished job is forgotten this long after it finished, as the old pending result was. */
const FINISHED_JOB_TTL_MS = 30 * 60 * 1000;

/**
 * A job belongs to the memory space it started in. A space switch stops and drops every
 * job, as a restart does, so a run writes no marks into the new space and Apply cannot
 * edit the new space's profile.
 */
const jobs = resettable("ai-cleanup-jobs", new Map<string, AiCleanupJob>(), (map) => {
  for (const job of map.values()) job.stopped = true;
  map.clear();
});
let nextId = 1;

/** Starts a cleanup job for the user, or returns the one already running. */
export function startAiCleanupJob(
  userId: string,
  input: AiCleanupJobInput,
  settings: MemoryModelSettings,
  deps: AiCleanupJobDeps = {}
): AiCleanupJobView {
  const current = jobs.get(userId);
  if (current?.status.state === "running") return view(current);

  const now = deps.now ?? Date.now;
  const selection = input.includeIds?.length ? input.includeIds : allIds(input.profileData);
  const batches = splitIntoBatches(
    selectForCleanup(input.profileData, selection),
    deps.batchSize ?? AI_CLEANUP_BATCH_SIZE
  );
  const job: AiCleanupJob = {
    id: String(nextId++),
    startedAt: now(),
    selection,
    status: { state: "running", done: 0, total: batches.length, failed: 0 },
    stopped: false,
    mergedItems: {},
  };
  jobs.set(userId, job);

  void (async () => {
    try {
      const result = await runInBatches(batches, {
        callBatch: deps.callBatch ?? ((batch) => cleanupBatch(batch, settings)),
        isStopped: () => job.stopped,
        onProgress: (done, total, failed) => {
          job.status = { state: "running", done, total, failed };
        },
      });
      if (!result) return;
      // Saved before the status reads done, so a reader never sees a done job without them.
      if (input.profileId) {
        await saveCheckedMarks(input.profileId, input, result.checkedIds);
      }
      if (job.stopped) return;
      job.mergedItems = result.mergedItems;
      job.status = {
        state: "done",
        result: {
          old: input.profileData,
          changes: result.diff,
          failedBatches: result.failedBatches,
          failedItems: result.failedItems,
        },
      };
    } catch (error) {
      if (job.stopped) return;
      const reason = failureReason(error);
      log("AI cleanup job: failed", { reason }, "error");
      job.status = {
        state: "failed",
        error:
          reason === "timeout"
            ? "The model did not answer in time."
            : error instanceof Error
              ? error.message
              : String(error),
      };
    } finally {
      job.finishedAt = now();
    }
  })();
  return view(job);
}

/**
 * Marks the kept items of successful batches as checked, then deletes the marks of the
 * profile that match no memory of the newest profile. A failure is logged as a code and
 * does not fail the job.
 */
async function saveCheckedMarks(
  profileId: string,
  input: AiCleanupJobInput,
  checkedIds: string[]
): Promise<void> {
  try {
    const keys = aiCheckedKeysForIds(input.profileData, checkedIds);
    await markAiChecked(profileId, keys);
    const current = await input.loadProfile?.();
    const pruned = current ? await pruneAiCheckedTo(profileId, aiCheckedKeysOf(current)) : 0;
    log("AI cleanup job: checked marks saved", { marked: keys.length, pruned });
  } catch (error) {
    log(
      "AI cleanup job: checked marks not saved",
      { code: error instanceof Error ? error.name : "unknown" },
      "error"
    );
  }
}

/** The user's job, or null when none was started or a finished one expired. */
export function getAiCleanupJob(userId: string, now = Date.now()): AiCleanupJobView | null {
  const job = liveJob(userId, now);
  return job ? view(job) : null;
}

/** The finished result that Apply needs, or null when the job is not done. */
export function getAiCleanupResult(userId: string, now = Date.now()): CleanupJobResult | null {
  const job = liveJob(userId, now);
  if (job?.status.state !== "done") return null;
  return {
    old: job.status.result.old,
    changes: job.status.result.changes,
    mergedItems: job.mergedItems,
  };
}

/** Stops a running job, or discards a finished one. A stopped job writes nothing. */
export function stopAiCleanupJob(userId: string): void {
  const job = jobs.get(userId);
  if (!job) return;
  job.stopped = true;
  jobs.delete(userId);
}

function liveJob(userId: string, now: number): AiCleanupJob | null {
  const job = jobs.get(userId);
  if (!job) return null;
  if (job.status.state !== "running" && job.finishedAt !== undefined) {
    if (now - job.finishedAt > FINISHED_JOB_TTL_MS) {
      jobs.delete(userId);
      return null;
    }
  }
  return job;
}

function view(job: AiCleanupJob): AiCleanupJobView {
  return { id: job.id, startedAt: job.startedAt, selection: job.selection, status: job.status };
}

function allIds(profile: UserProfileData): string[] {
  return [
    ...profile.preferences.map((_, i) => `pref_${i}`),
    ...profile.patterns.map((_, i) => `pat_${i}`),
    ...profile.workflows.map((_, i) => `wf_${i}`),
  ];
}
