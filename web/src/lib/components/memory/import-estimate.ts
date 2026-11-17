import type { ImportRunView } from "$lib/auto-import-settings";
import type { WebHost } from "$lib/host-label";
import type { HostResult, ImportCounts, ImportJob } from "./import-types";

/** What the confirm dialog shows before a real import starts. */
export type ImportEstimate = {
  sessions: number;
  /** Memory units to import plus profile analysis calls. The real count can be higher. */
  calls: number;
  /** Minutes at the speed of recent runs, or null when no finished run gives a speed. */
  minutes: number | null;
};

/** Each host's latest run record, as the backfill hook holds it. */
export type RunsByHost = Partial<Record<string, { run: ImportRunView } | null>> | null | undefined;

// A shorter or smaller run says too little about speed.
const MIN_UNITS = 5;
const MIN_RUN_MS = 60_000;

/** The host rows of a group job, or the job itself when it has none. */
function parts(job: ImportJob): ImportCounts[] {
  return job.hosts?.length ? job.hosts : [job];
}

function units(job: ImportJob): number {
  return parts(job).reduce((total, part) => total + (part.summary?.unitsWouldImport ?? 0), 0);
}

function sessions(job: ImportJob): number {
  return parts(job).reduce((total, part) => total + (part.sessions ?? 0), 0);
}

function profileCalls(job: ImportJob): number {
  // The server runs no host with zero sessions, so waiting prompts alone start no call.
  if (sessions(job) === 0) return 0;
  // Every host drains one shared queue, so the job's own estimate is the one to read.
  const estimate =
    job.profileEstimate ?? job.hosts?.find((host) => host.profileEstimate)?.profileEstimate;
  return estimate?.analysisCalls ?? 0;
}

function skillTurns(job: ImportJob): number {
  return parts(job).reduce((total, part) => total + (part.summary?.skillTurnsWouldRecord ?? 0), 0);
}

/** Memory units a minute from one finished run, or null when it says too little. */
function unitsPerMinute(run: ImportRunView): number | null {
  if (!run || run.state !== "done" || run.done < MIN_UNITS) return null;
  const duration = (run.updatedAt ?? 0) - (run.startedAt ?? 0);
  return duration >= MIN_RUN_MS ? run.done / (duration / 60_000) : null;
}

/** Model calls one host's part of the run makes: its units plus its profile calls. */
function hostCalls(part: HostResult): number {
  return (part.summary?.unitsWouldImport ?? 0) + (part.profileEstimate?.analysisCalls ?? 0);
}

/**
 * Sessions, model calls and time for a dry-run job. The server runs hosts one
 * after another, so the time is each host's calls at that host's own speed,
 * added up. Profile calls the host rows do not account for go to the first host,
 * which drains the shared queue. When any host with work has no measured speed
 * the time is unknown, and the dialog says so instead of guessing.
 */
export function importEstimate(job: ImportJob, runs: RunsByHost): ImportEstimate {
  const calls = units(job) + profileCalls(job);
  const hosts = job.hosts ?? [];
  const counted = hosts.reduce(
    (total, part) => total + (part.profileEstimate?.analysisCalls ?? 0),
    0
  );
  const extra = Math.max(0, profileCalls(job) - counted);
  // The shared profile calls run with the first host that has sessions.
  const first = hosts.findIndex((part) => (part.sessions ?? 0) > 0);
  let total = 0;
  let known = hosts.length > 0;
  hosts.forEach((part, index) => {
    const work = hostCalls(part) + (index === first ? extra : 0);
    if (work === 0) return;
    const rate = unitsPerMinute(runs?.[part.host]?.run ?? null);
    if (rate === null) known = false;
    else total += work / rate;
  });
  // Round up, so real work never reads 0 minutes. With no model calls there is no time to give.
  const minutes = known && calls > 0 ? Math.max(1, Math.ceil(total - 1e-9)) : null;
  return { sessions: sessions(job), calls, minutes };
}

/** The hosts of a preview that have sessions to run; the server skips the rest. */
export function hostsWithWork(job: ImportJob): WebHost[] {
  return (job.hosts ?? []).filter((part) => (part.sessions ?? 0) > 0).map((part) => part.host);
}

/** True when the preview has no sessions, units, profile calls or skill turns to import. */
export function nothingToImport(job: ImportJob): boolean {
  return (
    sessions(job) === 0 && units(job) === 0 && profileCalls(job) === 0 && skillTurns(job) === 0
  );
}
