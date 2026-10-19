import type { WebHost } from "$lib/host-label";
import type { ImportJob } from "./import-types";

const ACTIVE_JOB_STATES = ["queued", "preparing", "running", "cancelling"];

/**
 * The job to show when the page loads. The server keeps the last job after it
 * ends; only an active one is still news, so a reload does not bring back a
 * finished import's results.
 */
export function restorableJob(job: ImportJob | null): ImportJob | null {
  return job && ACTIVE_JOB_STATES.includes(job.state) ? job : null;
}

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
  // The group's state and error describe whichever host failed first. A later
  // host that never ran must not show them. A group error with no failed row
  // (preparation failure) still shows on every tab.
  const hostFailed = job.hosts.some((item) => item.state === "failed" || item.error);
  return {
    ...job,
    state: child.state,
    activeHost: job.activeHost === host ? host : null,
    error: child.error ?? (hostFailed ? undefined : job.error),
    sessions: child.sessions,
    processed: child.processed,
    total: child.total,
    summary: child.summary,
    profileEstimate: child.profileEstimate,
    hosts: [child],
  };
}
