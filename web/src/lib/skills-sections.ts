import { translateSettings } from "$lib/i18n/settings";

/** The Skills page sections, in page order. The sidebar links to each by its element id. */
export const SKILLS_SECTIONS = [
  { id: "skills-section-activity", title: "Activity" },
  { id: "skills-section-ranked", title: "Ranked skills" },
  { id: "skills-section-pending", title: "Pending proposals" },
  { id: "skills-section-recent", title: "Recent proposals" },
  { id: "skills-section-folders", title: "Watched folders" },
] as const;

/** The sidebar links under Skills, labelled in the chosen language. */
export const skillsSections = (language: "en" | "zh" | "ar") =>
  SKILLS_SECTIONS.map((section) => ({
    id: section.id,
    label: translateSettings(section.title, language),
  }));
