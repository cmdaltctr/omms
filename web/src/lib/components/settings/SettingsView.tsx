import { useEffect } from "react";
import type { ComponentType } from "react";
import "./settings.css";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "$lib/settings-sections";
import { revealSettingsAnchor } from "$lib/settings-navigation";
import { ModelsSection } from "./ModelsSection";
import { MemorySection } from "./MemorySection";
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
  "settings-section-memory": MemorySection,
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
  // The browser's hash jump runs before the cards exist, so a direct load or
  // reload of /settings#settings-section-... needs one scroll after mount.
  useEffect(() => {
    revealSettingsAnchor(window.location.hash, document);
  }, []);
  return (
    <div className="settings-view space-y-6">
      {SETTINGS_SECTIONS.map(({ id }) => {
        const Card = CARDS[id];
        // The sidebar's Settings tree scrolls to these anchors.
        return (
          <div key={id} id={id} className="scroll-mt-20 md:scroll-mt-4">
            <Card />
          </div>
        );
      })}
    </div>
  );
}
