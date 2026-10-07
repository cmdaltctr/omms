// One status poll for the whole page. The sidebar header, the power button, and
// the update button read the same `/api/web/status` reply, so the page sends one
// request per interval however many readers are mounted.
import { useSyncExternalStore } from "react";
import { readPowerStatus, STATUS_POLL_MS, type PowerStatus } from "./power";

export interface WebStatus {
  /** False when the last status call failed. */
  ok: boolean;
  /** The last status that answered, or null before the first answer. */
  status: PowerStatus | null;
}

let snapshot: WebStatus = { ok: true, status: null };
const listeners = new Set<(status: WebStatus) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let sent = 0;
let applied = 0;

/**
 * Read the status and tell every reader. Requests can finish out of order, so a
 * reply older than one already applied is dropped.
 */
export async function refreshWebStatus(): Promise<void> {
  const id = ++sent;
  const status = await readPowerStatus();
  if (id < applied) return;
  applied = id;
  snapshot = status ? { ok: true, status } : { ...snapshot, ok: false };
  for (const listener of listeners) listener(snapshot);
}

/** Follow the status. The first reader starts the poll and the last one stops it. */
export function subscribeWebStatus(listener: (status: WebStatus) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  void refreshWebStatus();
  timer ??= setInterval(() => void refreshWebStatus(), STATUS_POLL_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => snapshot;

/** The shared status. React re-renders a reader when the snapshot changes. */
export function useWebStatus(): WebStatus {
  return useSyncExternalStore(subscribeWebStatus, getSnapshot, getSnapshot);
}
