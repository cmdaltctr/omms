/**
 * The sections of one skill's view, in page order. The table of contents
 * links to each by its element id; Failures reads last, after Recent turns.
 */
export const SKILL_DETAIL_SECTIONS = [
  { id: "skill-section-uses", title: "Uses in the last 30 days" },
  { id: "skill-section-mode", title: "Mode" },
  { id: "skill-section-proposals", title: "Proposals" },
  { id: "skill-section-history", title: "History" },
  { id: "skill-section-turns", title: "Recent turns" },
  { id: "skill-section-failures", title: "Failures" },
] as const;
