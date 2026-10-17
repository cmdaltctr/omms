import { useCallback, useEffect, useRef, useState } from "react";
import { aiCleanupApi } from "$lib/api";
import { keepPolling, type AiCleanupJob } from "$lib/components/explorer/ai-cleanup-job-state";

const POLL_MS = 2000;

/**
 * The user's AI cleanup job. On open it reads the job, so a run started earlier shows its
 * progress or result. It polls only while the job runs and the dialog is open. Closing
 * the dialog does not stop the job.
 */
export function useAiCleanupJob(open: boolean) {
  const [job, setJob] = useState<AiCleanupJob | null>(null);
  const [startError, setStartError] = useState<string | undefined>();
  // Changing this asks the effect below to read the job again.
  const [reads, setReads] = useState(0);
  // Discard raises this, so a poll already in flight cannot bring the stopped job back.
  const generation = useRef(0);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mine = generation.current;
    const load = async () => {
      const result = await aiCleanupApi.status();
      if (stopped || generation.current !== mine) return;
      const next = result.success ? (result.data ?? null) : null;
      setJob(next);
      if (keepPolling(next, true)) timer = setTimeout(() => void load(), POLL_MS);
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open, reads]);

  useEffect(() => {
    if (!open) setStartError(undefined);
  }, [open]);

  const start = useCallback(
    async (includeIds: string[], profileVersion: number | undefined, fallbackError: string) => {
      setStartError(undefined);
      const result = await aiCleanupApi.start(includeIds, profileVersion);
      if (!result.success || !result.data) {
        setJob(null);
        setStartError(result.error || fallbackError);
        return;
      }
      setJob(result.data);
      setReads((n) => n + 1);
    },
    []
  );

  /** Stops a running job, or discards a finished or failed one. */
  const discard = useCallback(async () => {
    generation.current++;
    setJob(null);
    setStartError(undefined);
    await aiCleanupApi.stop();
  }, []);

  return { job, startError, start, discard, clear: () => setJob(null) };
}
