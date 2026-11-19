import { useEffect } from "react";
import type { ComponentType } from "react";
import "./settings.css";
import {
  SETTINGS_SECTIONS,
  selectedSettingsSection,
  visibleSettingsSections,
  type SettingsSectionId,
} from "$lib/settings-sections";
import { useProfileCount } from "$lib/profile-count";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import { navigate, usePath } from "$lib/router";
import { ROUTES } from "$lib/routes";
import { revealSettingsAnchor } from "$lib/settings-navigation";
import { useSettingsSnapshot } from "@/hooks/useSettingsSnapshot";
import { problemViews, type SnapshotProblem } from "$lib/config-problem-view";
import { ConfigProblemBanner } from "./ConfigProblemBanner";
import { MemoryBasicsSection } from "./MemoryBasicsSection";
import { MemoryCleanupSection } from "./MemoryCleanupSection";
import { SettingsSearch } from "./SettingsSearch";
import { ModelsSection } from "./ModelsSection";
import { ExternalApiSection } from "./ExternalApiSection";
import { EmbeddingSection } from "./EmbeddingSection";
import { KeysAccessSection } from "./KeysAccessSection";
import { ProfilesSection } from "./ProfilesSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { HealthSection } from "./HealthSection";
import { WebAppSection } from "./WebAppSection";
import { ClaudeFolderSection } from "./ClaudeFolderSection";
import { LogSection } from "./LogSection";
import { CaptureLanguageSection } from "./CaptureLanguageSection";
import { AppearanceSection } from "./AppearanceSection";
import { SkillLearningSection } from "./SkillLearningSection";

const CARDS: Record<SettingsSectionId, ComponentType> = {
  "settings-section-memory-basics": MemoryBasicsSection,
  "settings-section-memory-cleanup": MemoryCleanupSection,
  "settings-section-external-api": ExternalApiSection,
  "settings-section-models": ModelsSection,
  "settings-section-embedding": EmbeddingSection,
  "settings-section-keys": KeysAccessSection,
  "settings-section-diagnostics": DiagnosticsSection,
  "settings-section-health": HealthSection,
  "settings-section-claude-folder": ClaudeFolderSection,
  "settings-section-capture-language": CaptureLanguageSection,
  "settings-section-appearance": AppearanceSection,
  "settings-section-profiles": ProfilesSection,
  "settings-section-web-app": WebAppSection,
  "settings-section-skill-learning": SkillLearningSection,
  "settings-section-log": LogSection,
};

export function SettingsView() {
  // The browser's hash jump runs before the cards exist, so a direct load or
  // reload of /settings#settings-section-... needs one scroll after mount.
  useEffect(() => {
    revealSettingsAnchor(window.location.hash, document);
  }, []);
  const s = useSettingsText();
  const visible = visibleSettingsSections(useProfileCount());
  const selected = selectedSettingsSection(usePath(), visible);
  const { snapshot } = useSettingsSnapshot<{ problems?: SnapshotProblem[]; readOnly?: boolean }>();
  return (
    <div className="settings-view space-y-6">
      <SettingsSearch />
      <div role="group" aria-label={s("Sections")} className="flex flex-wrap gap-2">
        {visible.map(({ id, title }) => (
          <Button
            key={id}
            variant="chip"
            size="sm"
            aria-pressed={selected === id}
            // A chip switches the section in place: no scroll and no outline.
            onClick={() => navigate(`${ROUTES.settings}#${id}`, false, { reveal: false })}
          >
            {s(title)}
          </Button>
        ))}
      </div>
      <ConfigProblemBanner
        problems={problemViews(snapshot?.problems)}
        readOnly={snapshot?.readOnly === true}
      />
      {SETTINGS_SECTIONS.map(({ id }) => {
        const Card = CARDS[id];
        // The sidebar's Settings tree scrolls to these anchors. Every card stays mounted so a
        // draft survives a chip switch; the cards not selected are only hidden.
        return (
          <div key={id} id={id} hidden={id !== selected} className="scroll-mt-20 md:scroll-mt-4">
            <Card />
          </div>
        );
      })}
    </div>
  );
}
