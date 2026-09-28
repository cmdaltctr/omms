import type { CaptureFailureReason } from "./host.js";

/** What the capture pipeline knows about a failed attempt. */
export interface CaptureFailureInfo {
  reason: CaptureFailureReason;
  httpStatus?: number;
  retryAfterMs?: number;
}

export type CaptureRetryClass = "retryable" | "permanent";

/**
 * A retry can fix a model call that never got an answer, a timeout, a rate
 * limit, a server error, or a busy local store. Anything else would send the
 * same input to the same model for the same bad result, and each try costs.
 */
export function classifyCaptureFailure(failure: CaptureFailureInfo): CaptureRetryClass {
  if (failure.reason === "persist-error") return "retryable";
  if (failure.reason !== "call-error") return "permanent";
  const status = failure.httpStatus;
  if (status === undefined) return "retryable";
  if (status === 408 || status === 429 || status >= 500) return "retryable";
  return "permanent";
}

const QUICK_RETRY_BASE_MS = 2000;

/** The wait inside a turn after quick try `attempt` fails: 2 s, then 4 s, doubling. */
export function quickRetryDelayMs(attempt: number): number {
  return QUICK_RETRY_BASE_MS * Math.pow(2, attempt - 1);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Waits after the first to fourth failed tries; every later try waits 12 hours. */
export const CAPTURE_RETRY_WAITS_MS = [MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR] as const;
export const CAPTURE_RETRY_LATER_WAIT_MS = 12 * HOUR;
const JITTER = 0.2;

/**
 * The wait before the next try, after `failedTries` failed tries (the live
 * attempt counts as the first). Adds up to 20 % random extra wait, and never
 * returns less than a `Retry-After` value the API sent.
 */
export function captureRetryDelayMs(
  failedTries: number,
  retryAfterMs?: number,
  random: () => number = Math.random
): number {
  const index = Math.max(1, Math.floor(failedTries)) - 1;
  const base = CAPTURE_RETRY_WAITS_MS[index] ?? CAPTURE_RETRY_LATER_WAIT_MS;
  const delay = Math.round(base * (1 + JITTER * random()));
  return retryAfterMs !== undefined && retryAfterMs > delay ? retryAfterMs : delay;
}

/** Read an HTTP `Retry-After` header: seconds or an HTTP date. */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now()
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

function numberField(error: unknown, key: "httpStatus" | "retryAfterMs"): number | undefined {
  let current: unknown = error;
  // Follow a short cause chain: providers wrap errors once or twice.
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const value = (current as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The HTTP status a provider attached to a thrown error, if any. */
export function errorHttpStatus(error: unknown): number | undefined {
  return numberField(error, "httpStatus");
}

/** The `Retry-After` wait a provider attached to a thrown error, if any. */
export function errorRetryAfterMs(error: unknown): number | undefined {
  return numberField(error, "retryAfterMs");
}

/** An error that carries the HTTP status of the reply that caused it. */
export function httpStatusError(
  message: string,
  httpStatus: number,
  retryAfterMs?: number
): Error & { httpStatus: number; retryAfterMs?: number } {
  return Object.assign(new Error(message), {
    httpStatus,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
}
