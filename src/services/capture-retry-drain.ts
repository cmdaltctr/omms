import {
  CaptureAttemptError,
  captureConversation,
  type CaptureResult,
  type CaptureWorkUnit,
} from "../core/capture.js";
import {
  classifyCaptureFailure,
  errorHttpStatus,
  errorRetryAfterMs,
  type CaptureFailureInfo,
} from "../core/capture-retry-policy.js";
import type { CaptureSummaryProvider } from "../core/host.js";
import type { MemoryHost } from "../types/index.js";
import {
  claimCaptureRetry,
  deleteCaptureRetry,
  enqueueCaptureRetry,
  isCaptureRetryEnabled,
  listDueCaptureRetries,
  makeCaptureRetriesDue,
  pruneCaptureRetries,
  rescheduleCaptureRetry,
  type CaptureRetryConfig,
} from "./capture-retry-queue.js";
import { log } from "./logger.js";

export interface CaptureRetryDrainOptions {
  host: MemoryHost;
  provider: CaptureSummaryProvider;
  config: CaptureRetryConfig;
  now?: () => number;
  /** False skips the pass, e.g. while the embedding model is not ready. */
  isReady?: () => boolean;
  /** Runs after a retry saves or skips, so a host can update its own records. */
  onSettled?: (unit: CaptureWorkUnit, result: CaptureResult) => Promise<void>;
}

export interface CaptureRetryDrainResult {
  status: "done" | "running" | "off" | "not-ready" | "error";
  captured: number;
  skipped: number;
  dropped: number;
  /** True when the pass stopped at a failure a retry can fix. */
  stopped: boolean;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.name : "unknown";
}

/** What a thrown capture error says about the failure. */
export function captureFailureOf(error: unknown): CaptureFailureInfo {
  if (error instanceof CaptureAttemptError) return error.failure;
  return {
    reason: "call-error",
    httpStatus: errorHttpStatus(error),
    retryAfterMs: errorRetryAfterMs(error),
  };
}

/**
 * Queue a turn whose live capture failed, when a retry can fix the failure.
 * Never throws: a queue error must not change the live capture outcome.
 */
export async function queueFailedCapture(
  unit: CaptureWorkUnit,
  error: unknown,
  config: CaptureRetryConfig
): Promise<boolean> {
  try {
    const failure = captureFailureOf(error);
    if (classifyCaptureFailure(failure) !== "retryable") return false;
    const result = await enqueueCaptureRetry(unit, failure, config);
    if (result === "queued") {
      log("Capture queued for retry", {
        host: unit.host,
        sessionID: unit.hostSessionId,
        reason: failure.reason,
        httpStatus: failure.httpStatus ?? null,
      });
    }
    return result === "queued";
  } catch (queueError) {
    log("Capture retry queue write failed", { code: errorCode(queueError) });
    return false;
  }
}

const running = new Set<MemoryHost>();

/**
 * Retry this host's due turns, oldest first, one at a time. Deletes a turn
 * when its retry saves, skips or fails for good, and stops at the first
 * failure a retry can fix. One pass runs per host in each process.
 */
export async function drainCaptureRetries(
  options: CaptureRetryDrainOptions
): Promise<CaptureRetryDrainResult> {
  const result: CaptureRetryDrainResult = {
    status: "done",
    captured: 0,
    skipped: 0,
    dropped: 0,
    stopped: false,
  };
  const { host, config } = options;
  const now = options.now ?? Date.now;
  if (running.has(host)) return { ...result, status: "running" };
  running.add(host);
  try {
    // Expired rows go first, so they are never retried. At 0 every row goes.
    await pruneCaptureRetries(config, now());
    if (!isCaptureRetryEnabled(config)) return { ...result, status: "off" };
    if (options.isReady && !options.isReady()) return { ...result, status: "not-ready" };

    for (const row of await listDueCaptureRetries(host, config, now())) {
      if (!(await claimCaptureRetry(row.id, config, now()))) continue;
      let outcome: CaptureResult;
      try {
        outcome = await captureConversation(row.workUnit, options.provider);
      } catch (error) {
        const failure = captureFailureOf(error);
        if (classifyCaptureFailure(failure) === "retryable") {
          await rescheduleCaptureRetry(row, failure, config, now());
          result.stopped = true;
          break;
        }
        await deleteCaptureRetry(row.id, config);
        result.dropped++;
        continue;
      }
      await deleteCaptureRetry(row.id, config);
      if (outcome.status === "captured") result.captured++;
      else result.skipped++;
      try {
        await options.onSettled?.(row.workUnit, outcome);
      } catch (error) {
        log("Capture retry follow-up failed", { host, code: errorCode(error) });
      }
    }
    if (result.captured + result.skipped + result.dropped > 0 || result.stopped) {
      log("Capture retry pass finished", { host, ...result });
    }
    return result;
  } catch (error) {
    log("Capture retry pass failed", { host, code: errorCode(error) });
    return { ...result, status: "error" };
  } finally {
    running.delete(host);
  }
}

type HostDrain = () => Promise<CaptureRetryDrainResult>;
const registeredDrains = new Map<MemoryHost, HostDrain>();

/** A host registers its drain in its own process, so shared code never imports an adapter. */
export function registerCaptureRetryDrain(host: MemoryHost, drain: HostDrain | null): void {
  if (drain) registeredDrains.set(host, drain);
  else registeredDrains.delete(host);
}

/** Start the host's registered drain in the background, if this process has one. */
export function startCaptureRetryDrain(host: MemoryHost): void {
  const drain = registeredDrains.get(host);
  if (!drain) return;
  void drain().catch((error: unknown) =>
    log("Capture retry pass failed", { host, code: errorCode(error) })
  );
}

export type RetryNowResult = "started" | "scheduled" | "running";

/**
 * Make every queued turn of one host due now. Starts a pass when this process
 * runs that host; otherwise the turns retry at the host's next session start.
 */
export async function requestCaptureRetryNow(
  host: MemoryHost,
  config: CaptureRetryConfig
): Promise<RetryNowResult> {
  await makeCaptureRetriesDue(host, config);
  if (running.has(host)) return "running";
  if (!registeredDrains.has(host)) return "scheduled";
  startCaptureRetryDrain(host);
  return "started";
}
