import { log } from "../services/logger.js";
import { profileFailureCode, type ProfileFailureCode } from "./profile-failure.js";

/** After a failed profile pass, the process waits this long before the next one. */
export const PROFILE_FAILURE_WAIT_MS = 10 * 60 * 1000;

let lastFailureAt: number | null = null;

/**
 * An in-process gate: a failing batch is not retried, and paid for, after
 * every turn. Capture never checks it. A restart clears it.
 */
export const profileBackoff = {
  canRun(now = Date.now()): boolean {
    return lastFailureAt === null || now - lastFailureAt >= PROFILE_FAILURE_WAIT_MS;
  },
  recordSuccess(): void {
    lastFailureAt = null;
  },
  recordFailure(now = Date.now()): void {
    lastFailureAt = now;
  },
};

/** Log one metadata record for a failed pass and start the wait. */
export function recordProfileFailure(
  host: "opencode" | "pi" | "claude-code",
  message: string,
  error: unknown,
  now = Date.now()
): ProfileFailureCode {
  const reason = profileFailureCode(error);
  profileBackoff.recordFailure(now);
  log(message, { host, reason });
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
