import type { ModelPort } from "../core/profile-analysis.js";
import { profileCatchUpLock } from "../core/profile-backoff.js";
import type { ProfileFailureCode } from "../core/profile-failure.js";
import { randomUUID } from "node:crypto";
import { log } from "../services/logger.js";
import { CatchUpLease } from "../services/user-prompt/profile-catch-up-lease.js";
import { getTags } from "../services/tags.js";
import { drainProfileBacklog } from "./profile-backlog.js";

export const CATCH_UP_BATCH_SIZE = 50;

export interface CatchUpState {
  /** "superseded": a newer run, from the page or the terminal, took over. */
  state: "idle" | "running" | "paused" | "done" | "failed" | "superseded";
  batchesBuilt: number;
  remaining: number;
  reason?: ProfileFailureCode;
}

/**
 * Batch hooks that keep catch-up runs in different processes apart: the
 * newest run owns the record, and waits for the older run's current batch.
 */
export async function catchUpLeaseHooks(signal?: AbortSignal, lease = new CatchUpLease()) {
  const owner = `${process.pid}-${randomUUID()}`;
  await lease.take(owner);
  return {
    beforeBatch: () => lease.beginBatch(owner, { signal }),
    afterBatch: () => lease.endBatch(owner),
    release: () => lease.release(owner),
  };
}

export class CatchUpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "CatchUpError";
  }
}

/** The waiting prompts and the model calls a run would make. */
export async function previewCatchUp(): Promise<{ waiting: number; calls: number }> {
  const { userPromptManager } = await import("../services/user-prompt/user-prompt-manager.js");
  // Trivial prompts are skipped without a model call, so they are not counted.
  const waiting =
    (await userPromptManager.countUnanalyzedForUserLearning()) -
    (await userPromptManager.countTrivialPromptsForLearning());
  return { waiting, calls: Math.ceil(waiting / CATCH_UP_BATCH_SIZE) };
}

let job: CatchUpState = { state: "idle", batchesBuilt: 0, remaining: 0 };
let controller: AbortController | null = null;

export function catchUpState(): CatchUpState {
  return job;
}

/**
 * Start a catch-up run in the background with the saved external API, or
 * another model. Pause aborts between batches; Resume starts a new run that
 * continues from the prompts still waiting.
 */
export async function startCatchUp(
  directory: string,
  model?: ModelPort,
  onEnd?: (state: CatchUpState) => void
): Promise<CatchUpState> {
  const user = getTags(directory).user;
  if (!user.userEmail) throw new CatchUpError("Profile learning needs a user email", 400);
  if (!profileCatchUpLock.begin()) throw new CatchUpError("A catch-up run is already running", 409);
  let chosen: ModelPort;
  try {
    chosen = model ?? (await import("./model-selection.js")).selectImportModel({}).profile;
  } catch (error) {
    profileCatchUpLock.end();
    throw new CatchUpError(error instanceof Error ? error.message : "No model", 400);
  }
  const remaining = (await previewCatchUp()).waiting;
  controller = new AbortController();
  job = { state: "running", batchesBuilt: 0, remaining };
  const signal = controller.signal;
  const hooks = await catchUpLeaseHooks(signal);
  void drainProfileBacklog({
    beforeBatch: hooks.beforeBatch,
    afterBatch: hooks.afterBatch,
    user: { ...user, userEmail: user.userEmail },
    model: chosen,
    batchSize: CATCH_UP_BATCH_SIZE,
    signal,
    onProgress: (progress) => {
      job = { ...job, ...progress };
    },
  })
    .then((report) => {
      job = {
        state: report.reason
          ? "failed"
          : report.superseded
            ? "superseded"
            : signal.aborted
              ? "paused"
              : "done",
        batchesBuilt: report.batchesBuilt,
        remaining: report.remaining,
        ...(report.reason ? { reason: report.reason } : {}),
      };
    })
    .catch(() => {
      job = { ...job, state: "failed", reason: "error" };
    })
    .finally(async () => {
      await hooks.release().catch(() => {});
      profileCatchUpLock.end();
      controller = null;
      log("Profile catch-up ended", {
        outcome: job.state,
        batches: job.batchesBuilt,
        remaining: job.remaining,
        ...(job.reason ? { reason: job.reason } : {}),
      });
      onEnd?.(job);
    });
  return job;
}

export function pauseCatchUp(): CatchUpState {
  controller?.abort();
  return job;
}
