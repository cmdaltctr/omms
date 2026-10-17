import type { CleanupChanges, PendingCleanup } from "../../types";

type ProfileData = NonNullable<PendingCleanup["old"]>;

/** The AI cleanup job, as `GET /api/user-profile/ai-cleanup` returns it. */
export type AiCleanupJob = {
  id: string;
  selection: string[];
  status:
    | { state: "running"; done: number; total: number; failed: number }
    | {
        state: "done";
        result: {
          old: ProfileData;
          changes: CleanupChanges;
          failedBatches: number;
          failedItems: number;
        };
      }
    | { state: "failed"; error: string };
};

export type AiCleanupResult = Extract<AiCleanupJob["status"], { state: "done" }>["result"];

export type AiCleanupDialogView =
  | { phase: "select" }
  | { phase: "running"; done: number; total: number }
  | { phase: "review"; result: AiCleanupResult; notice: { batches: number; items: number } | null }
  | { phase: "failed"; error: string };

/** The screen for a job. A start that failed before a job existed shows its error. */
export function dialogView(job: AiCleanupJob | null, startError?: string): AiCleanupDialogView {
  if (!job) return startError ? { phase: "failed", error: startError } : { phase: "select" };
  const status = job.status;
  switch (status.state) {
    case "running":
      return { phase: "running", done: status.done, total: status.total };
    case "done": {
      const { failedBatches, failedItems } = status.result;
      const notice = failedBatches > 0 ? { batches: failedBatches, items: failedItems } : null;
      return { phase: "review", result: status.result, notice };
    }
    case "failed":
      return { phase: "failed", error: status.error };
  }
}

/** Only a running job changes, and only an open dialog shows it. */
export function keepPolling(job: AiCleanupJob | null, open: boolean): boolean {
  return open && job?.status.state === "running";
}

/** Stop returns to the selection the job ran with, which a reopened dialog no longer holds. */
export function selectionAfterStop(job: AiCleanupJob | null, current: Set<string>): Set<string> {
  return job ? new Set(job.selection) : current;
}

/** Retry runs the same selection again. */
export function retrySelection(job: AiCleanupJob | null, current: Set<string>): string[] {
  return job ? job.selection : [...current];
}
