/** The state of the category cleanup preview job, as `GET /api/user-profile/category-cleanup` returns it. */
export type CleanupJob = {
  id: string;
  status:
    | { state: "grouping" }
    | { state: "checking"; done: number; total: number }
    | { state: "done"; preview: { groups: unknown[] } }
    | { state: "failed"; error: string };
};

export type BannerView =
  | { kind: "grouping" }
  | { kind: "checking"; done: number; total: number }
  | { kind: "ready"; groups: number }
  | { kind: "failed"; error: string };

/** What the Profile page banner shows for a job, or null when it shows nothing. */
export function bannerView(job: CleanupJob | null): BannerView | null {
  if (!job) return null;
  const status = job.status;
  switch (status.state) {
    case "grouping":
      return { kind: "grouping" };
    case "checking":
      // The dialog shows a checking job with no batches as plain grouping.
      return status.total > 0
        ? { kind: "checking", done: status.done, total: status.total }
        : { kind: "grouping" };
    case "done":
      return { kind: "ready", groups: status.preview.groups.length };
    case "failed":
      return { kind: "failed", error: status.error };
  }
}

/** Only a job that is still working changes, so only then is another request worth making. */
export function keepPolling(job: CleanupJob | null): boolean {
  return job?.status.state === "grouping" || job?.status.state === "checking";
}
