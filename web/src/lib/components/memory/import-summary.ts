import type { ImportCounts, ImportJob } from "./import-types";

/** The three lines of the finish dialog, as numbers. */
export type ImportSummaryView = {
  /** Memories saved. */
  saved: number;
  /** Prompts the profile step recorded. */
  profilePrompts: number;
  failedUnits: number;
  profileFailed: boolean;
  /** Something failed: a unit, or the profile step. */
  failed: boolean;
};

/** Sum the counts over the hosts of a group job; a job with no host rows reads its own. */
export function importSummary(job: ImportJob): ImportSummaryView {
  const parts: ImportCounts[] = job.hosts?.length ? job.hosts : [job];
  const failedUnits = parts.reduce((total, part) => total + (part.summary?.unitsFailed ?? 0), 0);
  const profileFailed = parts.some((part) => part.summary?.profile?.failed === true);
  return {
    saved: parts.reduce((total, part) => total + (part.summary?.unitsImported ?? 0), 0),
    profilePrompts: parts.reduce(
      (total, part) => total + (part.summary?.profile?.promptsRecorded ?? 0),
      0
    ),
    failedUnits,
    profileFailed,
    failed: failedUnits > 0 || profileFailed,
  };
}
