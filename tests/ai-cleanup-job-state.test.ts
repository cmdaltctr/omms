import { describe, expect, it } from "bun:test";
import {
  dialogView,
  keepPolling,
  retrySelection,
  selectionAfterStop,
  type AiCleanupJob,
} from "../web/src/lib/components/explorer/ai-cleanup-job-state.js";

const old = { preferences: [], patterns: [], workflows: [] };
const changes = { kept: [], merged: [], removed: [] };

function job(status: AiCleanupJob["status"]): AiCleanupJob {
  return { id: "1", selection: ["pref_0", "pat_2"], status };
}

const running = job({ state: "running", done: 3, total: 14, failed: 0 });
const done = job({
  state: "done",
  result: { old, changes, failedBatches: 0, failedItems: 0 },
});
const doneWithFailures = job({
  state: "done",
  result: { old, changes, failedBatches: 1, failedItems: 100 },
});
const failed = job({ state: "failed", error: "The model did not answer in time." });

describe("dialogView", () => {
  it("shows progress as batch X of Y while the job runs", () => {
    expect(dialogView(running)).toEqual({ phase: "running", done: 3, total: 14 });
  });

  it("shows the selection when there is no job", () => {
    expect(dialogView(null)).toEqual({ phase: "select" });
  });

  it("shows the review with no notice when every batch worked", () => {
    expect(dialogView(done)).toEqual({ phase: "review", result: done.status.result, notice: null });
  });

  it("shows the failed-batch notice when a batch failed", () => {
    expect(dialogView(doneWithFailures)).toMatchObject({
      phase: "review",
      notice: { batches: 1, items: 100 },
    });
  });

  it("shows the error of a failed job", () => {
    expect(dialogView(failed)).toEqual({
      phase: "failed",
      error: "The model did not answer in time.",
    });
  });

  it("shows a start error that left no job", () => {
    expect(dialogView(null, "Profile changed. Reload it before running AI cleanup.")).toEqual({
      phase: "failed",
      error: "Profile changed. Reload it before running AI cleanup.",
    });
  });
});

describe("keepPolling", () => {
  it("polls only while the job runs and the dialog is open", () => {
    expect(keepPolling(running, true)).toBe(true);
    expect(keepPolling(running, false)).toBe(false);
    expect(keepPolling(done, true)).toBe(false);
    expect(keepPolling(failed, true)).toBe(false);
    expect(keepPolling(null, true)).toBe(false);
  });
});

describe("Stop and Retry", () => {
  it("returns to the selection with the job's items after Stop", () => {
    expect(selectionAfterStop(running, new Set(["wf_9"]))).toEqual(new Set(["pref_0", "pat_2"]));
  });

  it("keeps the dialog's selection after Stop when no job is known", () => {
    expect(selectionAfterStop(null, new Set(["wf_9"]))).toEqual(new Set(["wf_9"]));
  });

  it("retries with the failed job's selection", () => {
    expect(retrySelection(failed, new Set(["wf_9"]))).toEqual(["pref_0", "pat_2"]);
  });

  it("retries a failed start with the dialog's selection", () => {
    expect(retrySelection(null, new Set(["wf_9"]))).toEqual(["wf_9"]);
  });
});
