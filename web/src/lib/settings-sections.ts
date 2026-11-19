/**
 * The Settings page cards in page order. The sidebar tree and the page read
 * this one list, so a new card needs one entry here. Titles are the cards'
 * own headings, translated by the Settings text table. The Settings page
 * shows one of these at a time, chosen by the `#settings-section-<id>` hash.
 * Only these ids select a section; an anchor inside a card would select the
 * first one.
 */
export const SETTINGS_SECTIONS = [
  { id: "settings-section-memory-basics", title: "Memory basics" },
  { id: "settings-section-memory-cleanup", title: "Memory cleanup" },
  { id: "settings-section-external-api", title: "External API" },
  { id: "settings-section-models", title: "Models" },
  { id: "settings-section-embedding", title: "Embedding" },
  { id: "settings-section-keys", title: "Keys and access" },
  { id: "settings-section-diagnostics", title: "Capture diagnostics" },
  { id: "settings-section-health", title: "Health" },
  { id: "settings-section-claude-folder", title: "Claude Code folder" },
  { id: "settings-section-capture-language", title: "Memory language" },
  { id: "settings-section-appearance", title: "Appearance" },
  { id: "settings-section-profiles", title: "Profiles" },
  { id: "settings-section-web-app", title: "Web app" },
  { id: "settings-section-skill-learning", title: "Skill learning" },
  { id: "settings-section-log", title: "Log" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** The section the page address names: the first one for no hash or an unknown id. */
export function selectedSettingsSection(path: string): SettingsSectionId {
  const hash = path.includes("#") ? path.slice(path.indexOf("#") + 1) : "";
  return SETTINGS_SECTIONS.find((section) => section.id === hash)?.id ?? SETTINGS_SECTIONS[0].id;
}
