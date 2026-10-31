import { useEffect, useRef, useState } from "react";
import { settingsRequest } from "$lib/settings-api";
import { skillsApi } from "$lib/skills-api";
import { jobEnded } from "$lib/skills-model";
import type { ImportJob } from "../memory/import-types";

/**
 * Starts Record past turns and follows its job until it ends. `onEnd` runs
 * once, so the caller can reload its turn count.
 */
export function useRecordPast(onEnd: () => void) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const watching = useRef(false);
  const ended = useRef(onEnd);
  ended.current = onEnd;
  const jobId = job?.id;
  const running = Boolean(job) && !jobEnded(job!);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    watching.current = true;
    const timer = setInterval(() => {
      void settingsRequest<{ job: ImportJob | null }>("/api/settings/imports/current")
        .then((value) => {
          if (!mounted.current || !value.job || value.job.id !== jobId) return;
          setJob(value.job);
        })
        .catch((cause: Error) => {
          if (mounted.current) setError(cause.message);
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [running, jobId]);

  useEffect(() => {
    if (job && jobEnded(job) && watching.current) {
      watching.current = false;
      ended.current();
    }
  }, [job]);

  async function start() {
    if (starting || running) return;
    setStarting(true);
    setError("");
    const reply = await skillsApi.recordPast();
    if (!mounted.current) return;
    setStarting(false);
    if (!reply.ok) {
      setError(reply.error);
      return;
    }
    setJob((reply.data as unknown as { job: ImportJob }).job);
  }
  return { job, running, starting, error, start };
}
