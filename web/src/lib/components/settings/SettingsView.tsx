import type { ComponentType } from "react";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "$lib/settings-sections";
import { ModelsSection } from "./ModelsSection";
import { ExternalApiSection } from "./ExternalApiSection";
import { EmbeddingSection } from "./EmbeddingSection";
import { KeysAccessSection } from "./KeysAccessSection";
import { ProfileCatchUpSection } from "./ProfileCatchUpSection";
import { ProfilesSection } from "./ProfilesSection";
import { DirectoryMapsSection } from "./DirectoryMapsSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { HealthSection } from "./HealthSection";
import { ImportSection } from "./ImportSection";
import { AutoImportSection } from "./AutoImportSection";
import { WebAppSection } from "./WebAppSection";
import { ClaudeFolderSection } from "./ClaudeFolderSection";
import { LogSection } from "./LogSection";

const CARDS: Record<SettingsSectionId, ComponentType> = {
  "settings-section-external-api": ExternalApiSection,
  "settings-section-models": ModelsSection,
  "settings-section-embedding": EmbeddingSection,
  "settings-section-keys": KeysAccessSection,
  "settings-section-diagnostics": DiagnosticsSection,
  "settings-section-health": HealthSection,
  "settings-section-claude-folder": ClaudeFolderSection,
  "settings-section-import": ImportSection,
  "settings-section-auto-import": AutoImportSection,
  "settings-section-profile": ProfileCards,
  "settings-section-directory-maps": DirectoryMapsSection,
  "settings-section-web-app": WebAppSection,
  "settings-section-log": LogSection,
};

/** The Profiles card hides itself with one profile, so it shares the Profile learning anchor. */
function ProfileCards() {
  return (
    <div className="space-y-6">
      <ProfilesSection />
      <ProfileCatchUpSection />
    </div>
  );
}

export function SettingsView() {
  return (
    <div className="settings-view space-y-6">
      {SETTINGS_SECTIONS.map(({ id }) => {
        const Card = CARDS[id];
        // The sidebar's Settings tree scrolls to these anchors.
        return (
          <div key={id} id={id} className="scroll-mt-4">
            <Card />
          </div>
        );
      })}
    </div>
  );
}
