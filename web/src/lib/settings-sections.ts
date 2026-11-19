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

/** The sections that have something to show. The Profiles card needs two or more profiles. */
export function visibleSettingsSections(profileCount: number | undefined) {
  return SETTINGS_SECTIONS.filter(
    (section) =>
      section.id !== "settings-section-profiles" ||
      (profileCount !== undefined && profileCount >= 2)
  );
}

/**
 * The section the page address names: the first visible one for no hash, an unknown id or a
 * hidden section.
 */
export function selectedSettingsSection(
  path: string,
  sections: readonly { id: SettingsSectionId }[] = SETTINGS_SECTIONS
): SettingsSectionId {
  const hash = path.includes("#") ? path.slice(path.indexOf("#") + 1) : "";
  return sections.find((section) => section.id === hash)?.id ?? sections[0]!.id;
}
