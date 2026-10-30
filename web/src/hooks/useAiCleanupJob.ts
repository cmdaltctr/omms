import { useCallback, useEffect, useRef, useState } from "react";
import { aiCleanupApi } from "$lib/api";
import { afterStatusRead, type AiCleanupJob } from "$lib/components/explorer/ai-cleanup-job-state";

const POLL_MS = 2000;

/**
 * The user's AI cleanup job. On open it reads the job, so a run started earlier shows its
 * progress or result. It polls only while the job runs and the dialog is open. Closing
 * the dialog does not stop the job. With `follow`, it polls in every state while open.
 */
export function useAiCleanupJob(open: boolean, follow = false) {
  const [job, setJobState] = useState<AiCleanupJob | null>(null);
  // The poll reads the latest job here, since its closure holds an older render.
  const latest = useRef<AiCleanupJob | null>(null);
  const setJob = useCallback((next: AiCleanupJob | null) => {
    latest.current = next;
    setJobState(next);
  }, []);
  const [startError, setStartError] = useState<string | undefined>();
  // True once a read has answered, so "no job" is known and not just "not read yet".
  const [checked, setChecked] = useState(false);
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
      const next = afterStatusRead(latest.current, result, follow);
      setJob(next.job);
      if (result.success) setChecked(true);
      if (next.poll) timer = setTimeout(() => void load(), POLL_MS);
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open, follow, reads, setJob]);

  useEffect(() => {
    if (open) return;
    setStartError(undefined);
    // A reopened dialog waits for a fresh read before it trusts the job it kept.
    setChecked(false);
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
    [setJob]
  );

  /** Stops a running job, or discards a finished or failed one. */
  const discard = useCallback(async () => {
    generation.current++;
    setJob(null);
    setStartError(undefined);
    await aiCleanupApi.stop();
  }, [setJob]);

  return { job, checked, startError, start, discard, clear: () => setJob(null) };
}
