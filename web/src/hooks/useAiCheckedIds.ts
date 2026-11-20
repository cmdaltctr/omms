import { useCallback, useEffect, useState } from "react";
import { aiCleanupApi } from "$lib/api";

const NONE: ReadonlySet<string> = new Set();

/** The profile the dialog took when it opened. Its rows and the checked ids both use it. */
export type CheckedSnapshot = { version?: number };

type Answer = { snapshot: CheckedSnapshot; reads: number; ids: ReadonlySet<string> };

/**
 * The ids of the memories that AI Cleanup already checked, for the dialog's snapshot. It
 * reads them for each new snapshot and again on `reload` (after Back). `ready` is true only
 * when the read for this snapshot and this reload has answered. Until then the ids are
 * empty. Ids of another profile version, or a failed read, give a ready empty set.
 */
export function useAiCheckedIds(snapshot: CheckedSnapshot | null) {
  const [reads, setReads] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    let stopped = false;
    void (async () => {
      let ids: ReadonlySet<string> = NONE;
      try {
        const result = await aiCleanupApi.checked();
        if (result.success && result.data && result.data.profileVersion === snapshot.version) {
          ids = new Set(result.data.ids);
        }
      } catch {
        // A failed read must not block the cleanup; no memory counts as checked.
      }
      if (!stopped) setAnswer({ snapshot, reads, ids });
    })();
    return () => {
      stopped = true;
    };
  }, [snapshot, reads]);

  const reload = useCallback(() => setReads((n) => n + 1), []);
  const ready = !!answer && answer.snapshot === snapshot && answer.reads === reads;
  return { ids: ready && answer ? answer.ids : NONE, ready, reload };
}
