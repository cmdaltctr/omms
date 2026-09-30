// Calls behind the sidebar power button: read whether this caller may control
// the web app, send Stop or Restart, and wait for a restarted web app.

export type PowerAction = "stop" | "restart";

export interface PowerStatus {
  version: string;
  canControl: boolean;
}

export const STATUS_POLL_MS = 15_000;

const REQUEST_TIMEOUT_MS = 5_000;
/** How long to wait for the old process to stop answering before polling for the new one. */
const OLD_GONE_WAIT_MS = 3_000;
const OLD_GONE_POLL_MS = 250;
const RESTART_POLL_MS = 500;
const RESTART_WAIT_MS = 20_000;

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
    return { version: body.version, canControl: body.canControl };
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

async function answers(): Promise<boolean> {
  try {
    const response = await fetch("/api/health", { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return false;
    const body = (await response.json()) as { success?: unknown; status?: unknown };
    return body.success === true && body.status === "ok";
  } catch {
    return false;
  }
}

/**
 * After Restart: wait until the old process stops answering (or a short grace
 * passes), then poll until the new one answers. False when it never does.
 */
export async function waitForWebApp(
  deps: { sleep?: (ms: number) => Promise<void> } = {}
): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let waited = 0; waited < OLD_GONE_WAIT_MS; waited += OLD_GONE_POLL_MS) {
    if (!(await answers())) break;
    await sleep(OLD_GONE_POLL_MS);
  }
  for (let waited = 0; waited < RESTART_WAIT_MS; waited += RESTART_POLL_MS) {
    if (await answers()) return true;
    await sleep(RESTART_POLL_MS);
  }
  return answers();
}
