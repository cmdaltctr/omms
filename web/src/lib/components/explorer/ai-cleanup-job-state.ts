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

export type AiCleanupPillView =
  | { kind: "checking" }
  | { kind: "running"; done: number; total: number }
  | { kind: "ready" }
  | { kind: "failed" };

/** The pill of a minimised dialog. Before the first read it cannot tell "no job" yet. */
export function pillView(job: AiCleanupJob | null, checked: boolean): AiCleanupPillView | null {
  if (!job) return checked ? null : { kind: "checking" };
  const status = job.status;
  switch (status.state) {
    case "running":
      return { kind: "running", done: status.done, total: status.total };
    case "done":
      return { kind: "ready" };
    case "failed":
      return { kind: "failed" };
  }
}

/** Only a running job changes, and only an open dialog shows it. */
export function keepPolling(job: AiCleanupJob | null, open: boolean): boolean {
  return open && job?.status.state === "running";
}

/**
 * What one status read changes. A failed read says nothing about the job, so a running job
 * stays on screen and the next poll tries again. `follow` keeps polling in every state, so the
 * pill sees a finished job expire or be discarded elsewhere.
 */
export function afterStatusRead(
  current: AiCleanupJob | null,
  read: { success: boolean; data?: AiCleanupJob | null },
  follow = false
): { job: AiCleanupJob | null; poll: boolean } {
  const job = read.success ? (read.data ?? null) : current;
  return { job, poll: follow || keepPolling(job, true) };
}

/** Stop returns to the selection the job ran with, which a reopened dialog no longer holds. */
export function selectionAfterStop(job: AiCleanupJob | null, current: Set<string>): Set<string> {
  return job ? new Set(job.selection) : current;
}

/** Retry runs the same selection again. */
export function retrySelection(job: AiCleanupJob | null, current: Set<string>): string[] {
  return job ? job.selection : [...current];
}
