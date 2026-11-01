import { useSettingsText } from "$lib/i18n/settings";
import { PageToc } from "$lib/components/PageToc";
import { SKILL_DETAIL_SECTIONS } from "$lib/skill-detail-sections";

/**
 * The contents of one skill's view: the way back to all skills, then its
 * sections. A skill with no file in a watched folder has no Mode section, so
 * its contents leave that entry out rather than offer a link that goes
 * nowhere.
 */
export function SkillToc({ onBack, hasMode = true }: { onBack: () => void; hasMode?: boolean }) {
  const s = useSettingsText();
  const sections = hasMode
    ? SKILL_DETAIL_SECTIONS
    : SKILL_DETAIL_SECTIONS.filter((section) => section.id !== "skill-section-mode");
  return (
    <PageToc
      storageKey="omms-skill-toc-open"
      sections={sections}
      back={{ label: s("All skills"), onBack }}
    />
  );
}
