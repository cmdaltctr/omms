import { exitAfterInstall } from "../services/global-install.js";
import type { LogLevel } from "../services/logger.js";

// What a standalone web app does after it stops serving for a newer caller. The
// caller starts the newer copy, but a caller can quit first (a host that restarts
// for its own update), which left the port empty until some other host started a
// web app. So the old web app waits for a new owner, and restarts onto the newest
// copy itself when none comes.

/**
 * How long the old web app waits for the caller's copy to answer. An update restart can
 * take launchd's 30-second throttle plus the update's own 15-second wait, so give it 60.
 */
export const NEW_OWNER_WAIT_MS = 60_000;
const POLL_MS = 500;

export interface StepAsideDeps {
  /** True when an OMMS web app answers on the configured port. */
  ownerAnswers: () => Promise<boolean>;
  /** Restart onto the newest copy through the launcher. Returns a failure code when it did not. */
  restartNewest: () => Promise<string | undefined>;
  /** Serve again from this process. */
  resume: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  exit: (code: number) => void;
  log: (message: string, data: Record<string, unknown>, level?: LogLevel) => void;
}

/** Call after this web app stopped serving. It never leaves the port empty when it can help it. */
export async function leaveAfterStepAside(deps: StepAsideDeps): Promise<void> {
  // A step-aside or a retire waits for an install this process runs, so npm is never cut off mid-write.
  const exit = exitAfterInstall(deps.exit);
  const began = deps.now();
  while (deps.now() - began < NEW_OWNER_WAIT_MS) {
    if (await deps.ownerAnswers()) {
      exit(0);
      return;
    }
    await deps.sleep(POLL_MS);
  }
  deps.log("Web app step-aside", { code: "no-new-owner" }, "warn");
  // A successful restart exits this process.
  const code = await deps.restartNewest();
  if (code === undefined) return;
  // A failed restart can already serve again from this process.
  if (await deps.ownerAnswers()) return;
  try {
    await deps.resume();
  } catch {
    deps.log("Web app step-aside", { code: "resume-failed" }, "error");
    exit(1);
  }
}
