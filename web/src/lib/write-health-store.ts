import { useSyncExternalStore } from "react";
import { settingsRequest } from "./settings-api";

export type WriteHealth = { ok: boolean; reason: string | null; checkedAt: number };

const RECHECK_MS = 5 * 60_000;
let state: WriteHealth | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
// Readers that only show the last result; they never start or stop the checks.
const watchers = new Set<() => void>();

async function load(fresh: boolean): Promise<void> {
  try {
    state = await settingsRequest<WriteHealth>(
      `/api/memory/write-health${fresh ? "?fresh=1" : ""}`
    );
  } catch {
    // The web app itself is unreachable; that is not a write failure, so keep the last result.
  }
  for (const listener of [...listeners, ...watchers]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void load(false);
    timer = setInterval(() => {
      if (!document.hidden) void load(false);
    }, RECHECK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearInterval(timer);
  };
}

/** Whether memories can be saved. Checked on open, every 5 minutes while visible, and on request. */
export function useWriteHealth() {
  const health = useSyncExternalStore(
    subscribe,
    () => state,
    () => null
  );
  return { health, recheck: () => load(true) };
}

function watch(listener: () => void) {
  watchers.add(listener);
  return () => watchers.delete(listener);
}

/** The last result, for places such as the sidebar that must not trigger a check themselves. */
export function useWriteHealthValue(): WriteHealth | null {
  return useSyncExternalStore(
    watch,
    () => state,
    () => null
  );
}
