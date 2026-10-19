import type { WebHost } from "$lib/host-label";
import type { ImportJob } from "./import-types";

/**
 * The server keeps one current import job for the whole app. A host tab shows
 * only its own part of it; the overview (no host) shows the whole job.
 */
export function jobForHost(job: ImportJob | null, host: WebHost | undefined): ImportJob | null {
  if (!job || !host) return job;
  if (!job.hosts) return job.host === host ? job : null;
  const child = job.hosts.find((item) => item.host === host);
  if (!child) return null;
  if (job.hosts.length === 1) return job;
  return {
    ...job,
    sessions: child.sessions,
    processed: child.processed,
    total: child.total,
    summary: child.summary,
    profileEstimate: child.profileEstimate,
    hosts: [child],
  };
}
