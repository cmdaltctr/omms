import type { SortOption } from "$lib/components/paged-list";
import type { BackupRow, SpaceRow } from "./spaces-api";

/* The sorts of the Backups list on the Spaces page and of the Archive list. Labels are English messages that the toolbar translates. */

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
const byDate = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "");

export type BackupSort = "newest" | "oldest" | "name" | "largest";
export const BACKUP_SORTS: readonly SortOption<BackupSort, BackupRow>[] = [
  {
    value: "newest",
    label: "Newest",
    first: "desc",
    flip: "oldest",
    compare: (a, b) => byDate(a.createdAt, b.createdAt),
  },
  {
    value: "oldest",
    label: "Oldest",
    first: "asc",
    flip: "newest",
    compare: (a, b) => byDate(a.createdAt, b.createdAt),
  },
  {
    value: "name",
    label: "Name (A–Z)",
    first: "asc",
    compare: (a, b) => byText(a.spaceName, b.spaceName),
  },
  {
    value: "largest",
    label: "Largest",
    first: "desc",
    compare: (a, b) => a.sizeBytes - b.sizeBytes,
  },
];

export type ArchiveSort = "archived" | "name" | "created" | "size";
/** The Archive list. A date that OMMS never recorded always sorts last. */
export const ARCHIVE_SORTS: readonly SortOption<ArchiveSort, SpaceRow>[] = [
  {
    value: "archived",
    label: "Newest archived",
    first: "desc",
    compare: (a, b) => byDate(a.archivedAt, b.archivedAt),
    last: (space) => space.archivedAt === null,
  },
  { value: "name", label: "Name (A–Z)", first: "asc", compare: (a, b) => byText(a.name, b.name) },
  {
    value: "created",
    label: "Created",
    first: "desc",
    compare: (a, b) => byDate(a.createdAt, b.createdAt),
    last: (space) => space.createdAt === null,
  },
  { value: "size", label: "Largest", first: "desc", compare: (a, b) => a.sizeBytes - b.sizeBytes },
];
