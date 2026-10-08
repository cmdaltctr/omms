/** Memory operations in page and sidebar order. */
export const MEMORY_SECTIONS = [
  { id: "memory-section-import", title: "Import chat history" },
  { id: "memory-section-auto-import", title: "Automatic import" },
  { id: "memory-section-profile", title: "Profile learning" },
  { id: "memory-section-limits", title: "Memory limits" },
  { id: "memory-section-project-folders", title: "Resolve missing project folders" },
] as const;

export type MemorySectionId = (typeof MEMORY_SECTIONS)[number]["id"];

const LEGACY_ANCHORS: Record<string, string> = {
  "settings-section-import": "memory-section-import",
  "settings-section-auto-import": "memory-section-auto-import",
  "settings-section-profile": "memory-section-profile",
  "settings-section-memory": "memory-section-limits",
  "settings-section-directory-maps": "memory-section-project-folders",
};

/** Resolve bookmarked Settings operations before rendering a page. */
export function legacyMemoryAnchor(path: string, hash: string): string | null {
  if (path !== "/settings") return null;
  const id = hash.replace(/^#/, "");
  if (LEGACY_ANCHORS[id]) return `#${LEGACY_ANCHORS[id]}`;
  return /^directory-maps-(pi|opencode|claude-code)$/.test(id) ? hash : null;
}
