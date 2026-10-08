/**
 * The Settings page cards in page order. The sidebar tree and the page read
 * this one list, so a new card needs one entry here. Titles are the cards'
 * own headings, translated by the Settings text table.
 */
export const SETTINGS_SECTIONS = [
  { id: "settings-section-external-api", title: "External API" },
  { id: "settings-section-models", title: "Models" },
  { id: "settings-section-embedding", title: "Embedding" },
  { id: "settings-section-keys", title: "Keys and access" },
  { id: "settings-section-diagnostics", title: "Capture diagnostics" },
  { id: "settings-section-health", title: "Health" },
  { id: "settings-section-claude-folder", title: "Claude Code folder" },
  { id: "settings-section-profiles", title: "Profiles" },
  { id: "settings-section-web-app", title: "Web app" },
  { id: "settings-section-log", title: "Log" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
