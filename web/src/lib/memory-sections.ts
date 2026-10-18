import { hostLabel } from "./host-label";
import { MEMORY_VIEWS, memoryPath, type MemoryViewId } from "./routes";

/** Memory views in sidebar order. Host names are not translated. */
export const MEMORY_SECTIONS = MEMORY_VIEWS.map((id) => ({
  id,
  title: id === "shared" ? "Shared" : hostLabel(id),
}));

/** Rows of the Shared view in page order: the anchor of each and its title. */
export const SHARED_ROWS = [
  { id: "shared-profile", title: "Profile learning" },
  { id: "shared-limits", title: "Memory limits" },
  { id: "shared-keywords", title: "Keyword matching" },
  { id: "shared-reranker", title: "Reranker" },
  { id: "shared-directory-maps", title: "Directory maps" },
] as const;

export const SHARED_ROW_IDS = SHARED_ROWS.map((row) => row.id);

const shared = (row: (typeof SHARED_ROWS)[number]["id"]) => `${memoryPath("shared")}#${row}`;
const OVERVIEW = "/memory";

const SETTINGS_ANCHORS: Record<string, string> = {
  "settings-section-import": OVERVIEW,
  "settings-section-auto-import": OVERVIEW,
  "settings-section-profile": shared("shared-profile"),
  "settings-section-memory": shared("shared-limits"),
  "settings-section-directory-maps": shared("shared-directory-maps"),
};

const MEMORY_ANCHORS: Record<string, string> = {
  "memory-section-import": OVERVIEW,
  "memory-section-auto-import": OVERVIEW,
  "memory-section-profile": shared("shared-profile"),
  "memory-section-limits": shared("shared-limits"),
  "memory-section-keywords": shared("shared-keywords"),
  "memory-section-reranker": shared("shared-reranker"),
  "memory-section-project-folders": shared("shared-directory-maps"),
};

/**
 * Where a bookmarked Settings or Memory anchor lives now, as a full path with
 * its row anchor, or null when the anchor did not move. Following one never
 * saves config or starts model work.
 */
export function legacyMemoryDestination(path: string, hash: string): string | null {
  if (path !== "/settings" && path !== OVERVIEW) return null;
  const id = hash.replace(/^#/, "");
  const host = /^directory-maps-(pi|opencode|claude-code)$/.exec(id)?.[1] as
    MemoryViewId | undefined;
  if (host) return `${memoryPath(host)}#host-unresolved`;
  return (path === "/settings" ? SETTINGS_ANCHORS : MEMORY_ANCHORS)[id] ?? null;
}
