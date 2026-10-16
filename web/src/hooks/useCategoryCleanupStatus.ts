import { useEffect, useState } from "react";
import { fetchAPI } from "$lib/api";
import { keepPolling, type CleanupJob } from "$lib/category-cleanup-status";

/** Same interval as the review dialog's poll. */
const POLL_MS = 3000;

/**
 * The state of the category cleanup preview job, for the Profile page banner. It only reads,
 * so it never starts a job. It asks again only while the job is working. A failed request
 * gives null with no message, and the next request waits for the page to open again or for
 * `paused` to end. While `paused` it sends nothing.
 */
export function useCategoryCleanupStatus(paused: boolean): CleanupJob | null {
  const [job, setJob] = useState<CleanupJob | null>(null);

  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const result = await fetchAPI<CleanupJob | null>("/api/user-profile/category-cleanup");
      if (stopped) return;
      const next = result.success ? (result.data ?? null) : null;
      setJob(next);
      if (keepPolling(next)) timer = setTimeout(() => void load(), POLL_MS);
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [paused]);

  return job;
}
