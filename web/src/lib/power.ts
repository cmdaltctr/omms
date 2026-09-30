// Calls behind the sidebar power button: read whether this caller may control
// the web app, send Stop or Restart, and wait for a restarted web app.

/** Matches the web app routes `/api/web/stop` and `/api/web/restart`. */
export type PowerAction = "stop" | "restart";

/** The reply of `/api/web/status`; `canControl` is false for a caller that is not local. */
export interface PowerStatus {
  version: string;
  canControl: boolean;
  /** Differs between web app processes; a restart shows up as a new value. */
  instance?: string;
}

/** What the page saw after Restart: a new process, only the old one, or nothing. */
export type RestartOutcome = "restarted" | "unchanged" | "down";

/** Often enough for the button colour to follow a stop from elsewhere, rare enough to stay cheap. */
export const STATUS_POLL_MS = 15_000;

const REQUEST_TIMEOUT_MS = 5_000;
const RESTART_POLL_MS = 500;
/** Longer than the web app's 15-second handoff, so a failed restart shows as "unchanged". */
const RESTART_WAIT_MS = 30_000;

const authHeaders = () => ({ "x-omms-token": window.__OMMS_TOKEN__ ?? "" });

/** The web app's status, or null when the call fails. */
export async function readPowerStatus(): Promise<PowerStatus | null> {
  try {
    const response = await fetch("/api/web/status", {
      headers: authHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<PowerStatus>;
    if (typeof body.version !== "string" || typeof body.canControl !== "boolean") return null;
    return {
      version: body.version,
      canControl: body.canControl,
      ...(typeof body.instance === "string" ? { instance: body.instance } : {}),
    };
  } catch {
    return null;
  }
}

/** True when the web app accepted the request (`202`). */
export async function sendPowerAction(action: PowerAction): Promise<boolean> {
  try {
    const response = await fetch(`/api/web/${action}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.status === 202;
  } catch {
    return false;
  }
}

/**
 * After Restart: poll the status until a process with a new instance value
 * answers. The old process keeps answering for a moment after its `202`, and
 * serves again when the restart fails, so a plain health check cannot tell.
 */
export async function waitForWebApp(
  previousInstance: string | null,
  deps: { sleep?: (ms: number) => Promise<void> } = {}
): Promise<RestartOutcome> {
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last: PowerStatus | null;
  for (let waited = 0; ; waited += RESTART_POLL_MS) {
    last = await readPowerStatus();
    if (last && last.instance !== previousInstance) return "restarted";
    if (waited >= RESTART_WAIT_MS) break;
    await sleep(RESTART_POLL_MS);
  }
  return last ? "unchanged" : "down";
}
