import { log } from "../services/logger.js";
import { profileFailureCode, type ProfileFailureCode } from "./profile-failure.js";

/** After a failed profile pass, the process waits this long before the next one. */
export const PROFILE_FAILURE_WAIT_MS = 10 * 60 * 1000;

export interface Backoff {
  canRun(now?: number): boolean;
  recordSuccess(): void;
  recordFailure(now?: number): void;
}

/**
 * An in-process gate: a failing batch is not retried, and paid for, after
 * every turn. Capture never checks it. A restart clears it. Each instance
 * keeps its own wait, so a failure in one never pauses another.
 */
export function createBackoff(waitMs: number): Backoff {
  let lastFailureAt: number | null = null;
  return {
    canRun(now = Date.now()): boolean {
      return lastFailureAt === null || now - lastFailureAt >= waitMs;
    },
    recordSuccess(): void {
      lastFailureAt = null;
    },
    recordFailure(now = Date.now()): void {
      lastFailureAt = now;
    },
  };
}

export const profileBackoff = createBackoff(PROFILE_FAILURE_WAIT_MS);

/** After a failed skill draft, automatic review waits 10 minutes. Profile learning keeps running. */
export const skillDraftBackoff = createBackoff(10 * 60 * 1000);

/**
 * Log one metadata record for a failed pass and start the wait on `backoff`.
 * `host` is null for skill drafting, which runs for every host.
 */
export function recordProfileFailure(
  host: "opencode" | "pi" | "claude-code" | null,
  message: string,
  error: unknown,
  now = Date.now(),
  backoff: Backoff = profileBackoff
): ProfileFailureCode {
  const reason = profileFailureCode(error);
  backoff.recordFailure(now);
  log(message, { host, reason }, "error");
  return reason;
}

let catchUpActive = false;

/** One catch-up run at a time, and no live pass in this process while it runs. */
export const profileCatchUpLock = {
  isActive: (): boolean => catchUpActive,
  begin(): boolean {
    if (catchUpActive) return false;
    catchUpActive = true;
    return true;
  },
  end(): void {
    catchUpActive = false;
  },
};
