export {
  INTERNAL_CAPTURE_SESSION_TITLE,
  INTERNAL_CAPTURE_SESSION_TITLES,
  isInternalCaptureSessionTitle,
} from "../../importer/opencode-internal-sessions.js";

/** Grace period so session.idle can still match after best-effort delete. */
const UNTRACK_GRACE_MS = 60_000;

const trackedSessionIDs = new Set<string>();
const untrackTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function trackInternalCaptureSession(sessionID: string): void {
  const pending = untrackTimers.get(sessionID);
  if (pending) {
    clearTimeout(pending);
    untrackTimers.delete(sessionID);
  }
  trackedSessionIDs.add(sessionID);
}

export function untrackInternalCaptureSession(sessionID: string): void {
  const pending = untrackTimers.get(sessionID);
  if (pending) {
    clearTimeout(pending);
  }
  const timer = setTimeout(() => {
    trackedSessionIDs.delete(sessionID);
    untrackTimers.delete(sessionID);
  }, UNTRACK_GRACE_MS);
  untrackTimers.set(sessionID, timer);
}

export function isTrackedInternalCaptureSession(sessionID: string): boolean {
  return trackedSessionIDs.has(sessionID);
}
