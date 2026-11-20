import { useCallback, useEffect, useState } from "react";
import { aiCleanupApi } from "$lib/api";

const NONE: ReadonlySet<string> = new Set();

/**
 * The ids of the memories that AI Cleanup already checked. It reads them when the dialog
 * opens and again on `reload` (after Back). Ids of another profile version, or a failed
 * read, give an empty set, so the shortcuts then treat no memory as checked.
 */
export function useAiCheckedIds(open: boolean, version: number | undefined) {
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    void (async () => {
      let next: ReadonlySet<string> = new Set();
      try {
        const result = await aiCleanupApi.checked();
        if (result.success && result.data && result.data.profileVersion === version) {
          next = new Set(result.data.ids);
        }
      } catch {
        // A failed read must not block the cleanup; no memory counts as checked.
      }
      if (!stopped) setIds(next);
    })();
    return () => {
      stopped = true;
    };
  }, [open, version, reads]);

  const reload = useCallback(() => setReads((n) => n + 1), []);
  return { ids, reload };
}
