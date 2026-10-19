import type { WebHost } from "$lib/host-label";
import type { ImportJob } from "./import-types";

/** Pure rules for the progress bar and the end-of-run announcement. */

export type BarView = {
  host: WebHost;
  phase: "memory" | "profile";
  done: number;
  total: number;
  percent: number;
};

const LIVE = ["running", "cancelling"];
const ENDED = ["done", "failed", "cancelled"];

/**
 * The bar for the active host of a real run, or null. The memory phase and the
 * profile phase keep their own counts, so a memory percentage never reads as
 * group progress.
 */
export function progressBarView(job: ImportJob | null): BarView | null {
  if (!job || job.dryRun || !LIVE.includes(job.state)) return null;
  const child = job.hosts?.find((item) => item.state === "running");
  if (!child) return null;
  const profile = child.phase === "profile";
  const done = (profile ? child.profileProcessed : child.processed) ?? 0;
  const total = (profile ? child.profileTotal : child.total) ?? 0;
  return {
    host: child.host,
    phase: profile ? "profile" : "memory",
    done,
    total,
    percent: total > 0 ? Math.min(100, Math.floor((done * 100) / total)) : 0,
  };
}

export type EndView = "dialog" | "banner" | "none";

/**
 * How to announce `current`. `previous` is the last job this page saw, or null
 * when it has seen none. A run that ends after the page saw it running opens
 * the dialog. A run that had already ended when the page first saw it opens the
 * banner. A preview, a cancelled run, a dismissed run, and a run announced
 * before give none.
 */
export function classifyEnd(
  previous: ImportJob | null,
  current: ImportJob | null,
  dismissedId: string | null
): EndView {
  if (!current || current.dryRun || !ENDED.includes(current.state)) return "none";
  if (current.state === "cancelled" || current.id === dismissedId) return "none";
  if (!previous) return "banner";
  if (previous.id === current.id && ENDED.includes(previous.state)) return "none";
  return "dialog";
}

/** Failed memory units across hosts, from each host's own counts. */
export function failedUnits(job: ImportJob | null): number {
  if (!job) return 0;
  if (job.hosts?.length)
    return job.hosts.reduce((total, child) => total + (child.summary?.unitsFailed ?? 0), 0);
  return job.summary?.unitsFailed ?? 0;
}

/** The first host error, else the group error. */
export function failureReason(job: ImportJob): string | undefined {
  return job.hosts?.find((child) => child.error)?.error ?? job.error;
}

export const SETTINGS_RELOAD_FAILED = "Could not reload the settings. Reload the page.";

/**
 * Work done when the user clicks OK. Returns a message when the settings
 * reload failed (it resolves null then), so readiness and host status stay
 * stale. The job refresh runs either way.
 */
export async function reloadAfterFinish(
  reloadSettings: () => Promise<unknown>,
  refreshJob: () => Promise<unknown>
): Promise<string | null> {
  const [snapshot] = await Promise.all([reloadSettings(), refreshJob().catch(() => {})]);
  return snapshot === null ? SETTINGS_RELOAD_FAILED : null;
}

const DISMISSED_KEY = "omms.import.dismissedEnd";

/** Per-viewer convenience; storage can be missing or blocked. */
export function readDismissedEnd(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function writeDismissedEnd(id: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, id);
  } catch {
    // The banner then shows again after a reload, once per page load.
  }
}
