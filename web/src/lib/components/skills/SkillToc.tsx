import { useSettingsText } from "$lib/i18n/settings";
import { PageToc } from "$lib/components/PageToc";
import { SKILL_DETAIL_SECTIONS } from "$lib/skill-detail-sections";

/** The contents of one skill's view: the way back to all skills, then its sections. */
export function SkillToc({ onBack }: { onBack: () => void }) {
  const s = useSettingsText();
  return (
    <PageToc
      storageKey="omms-skill-toc-open"
      sections={SKILL_DETAIL_SECTIONS}
      back={{ label: s("All skills"), onBack }}
    />
  );
}
