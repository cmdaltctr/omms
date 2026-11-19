import { useEffect, useSyncExternalStore } from "react";
import { settingsRequest } from "$lib/settings-api";

// The Profiles card has nothing to show below two profiles, so the Settings chip, the sidebar
// entry and the import link read this one count and hide themselves. `undefined` means the count
// is not known yet (not loaded, or the load failed); callers treat it as "hide".
let count: number | undefined;
let loading = false;
const listeners = new Set<() => void>();

/** Set the count and tell every reader. The Profiles card calls this after each reload. */
export function setProfileCount(next: number | undefined): void {
  if (next === count) return;
  count = next;
  for (const listener of listeners) listener();
}

async function loadProfileCount(): Promise<void> {
  if (count !== undefined || loading) return;
  loading = true;
  try {
    const { profiles } = await settingsRequest<{ profiles?: unknown }>("/api/settings/profiles");
    if (Array.isArray(profiles)) setProfileCount(profiles.length);
  } catch {
    // A failed read keeps the count unknown, so the Profiles links stay hidden.
  } finally {
    loading = false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The number of active profiles, loaded once for the whole page. */
export function useProfileCount(): number | undefined {
  useEffect(() => {
    void loadProfileCount();
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => count,
    () => count
  );
}
