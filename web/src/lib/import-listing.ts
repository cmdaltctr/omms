/**
 * Merge a newly fetched page of sessions into the current listing. Paging
 * within the same revision keeps the original listing time, because that time
 * is the turn cutoff a preview used; the import that follows must use it too.
 */
export function mergeListing<T extends { revision: string; listedAt: number }>(
  current: T | null,
  next: T,
  refresh: boolean
): { page: T; sameListing: boolean } {
  const sameListing = !refresh && current !== null && current.revision === next.revision;
  return { page: sameListing ? { ...next, listedAt: current.listedAt } : next, sameListing };
}
