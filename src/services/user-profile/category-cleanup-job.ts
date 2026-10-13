import { log } from "../logger.js";
import {
  previewCategoryCleanup,
  type CategoryCleanupPreview,
  type CleanupDeps,
} from "./category-cleanup.js";

/**
 * A preview on a large profile can take many minutes (one profile model call per
 * 20 groups, one at a time), longer than a web request may stay open. The web app
 * therefore builds it as a background job per user and the dialog polls its state.
 * Jobs live in this process only; a restart drops them.
 */
export type CleanupJobStatus =
  | { state: "grouping" }
  | { state: "checking"; done: number; total: number }
  | { state: "done"; preview: CategoryCleanupPreview }
  | { state: "failed"; error: string };

export interface CleanupJob {
  id: string;
  startedAt: number;
  status: CleanupJobStatus;
}

const jobs = new Map<string, CleanupJob>();
let nextId = 1;

function running(job: CleanupJob | undefined): job is CleanupJob {
  return !!job && (job.status.state === "grouping" || job.status.state === "checking");
}

/** Starts a preview job for the user, or returns the one already running. */
export function startCategoryCleanupJob(userId: string, deps: CleanupDeps = {}): CleanupJob {
  const current = jobs.get(userId);
  if (running(current)) return current;
  const job: CleanupJob = {
    id: String(nextId++),
    startedAt: Date.now(),
    status: { state: "grouping" },
  };
  jobs.set(userId, job);
  void (async () => {
    try {
      const preview = await previewCategoryCleanup(userId, {
        ...deps,
        onProgress: (done, total) => {
          job.status = { state: "checking", done, total };
        },
      });
      job.status = preview
        ? { state: "done", preview }
        : { state: "failed", error: "No profile found to clean up" };
    } catch (error) {
      log("category cleanup job: failed", {
        code: error instanceof Error ? error.name : "unknown",
      });
      job.status = {
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  return job;
}

/** Forgets the user's finished job, so the next preview reflects the changed profile. */
export function clearCategoryCleanupJob(userId: string): void {
  if (!running(jobs.get(userId))) jobs.delete(userId);
}

export function getCategoryCleanupJob(userId: string): CleanupJob | null {
  return jobs.get(userId) ?? null;
}
