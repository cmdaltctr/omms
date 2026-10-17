import { useCallback, useEffect, useState } from "react";
import { autoCleanupApi } from "$lib/api";
import type { AutoCleanupRecord } from "$lib/components/explorer/auto-cleanup-undo-state";

/**
 * The newest automatic cleanup that can be undone, or null. It reads again when `version`
 * changes, because a run saves a new profile version, and when `reload` is called. A failed
 * read gives null: the button then stays hidden until the next read.
 */
export function useAutoCleanupRecord(version: number | undefined) {
  const [record, setRecord] = useState<AutoCleanupRecord | null>(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let stopped = false;
    void autoCleanupApi.status().then((result) => {
      if (!stopped) setRecord(result.success ? (result.data ?? null) : null);
    });
    return () => {
      stopped = true;
    };
  }, [version, reads]);

  const reload = useCallback(() => setReads((n) => n + 1), []);
  return { record, reload };
}
