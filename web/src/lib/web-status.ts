// One status poll for the whole page. The sidebar header, the power button, and
// the update button read the same `/api/web/status` reply, so the page sends one
// request per interval however many readers are mounted. A new reader reads once.
import { useEffect, useState } from "react";
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
/** Read the status now and tell every reader. */
export async function refreshWebStatus(): Promise<void> {
  const status = await readPowerStatus();
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

export function useWebStatus(): WebStatus {
  const [value, setValue] = useState<WebStatus>(snapshot);
  useEffect(() => subscribeWebStatus(setValue), []);
  return value;
}
