import { ModelsSection } from "./ModelsSection";
import { ExternalApiSection } from "./ExternalApiSection";
import { DirectoryMapsSection } from "./DirectoryMapsSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { HealthSection } from "./HealthSection";
import { ImportSection } from "./ImportSection";
import { AutoImportSection } from "./AutoImportSection";
import { WebAppSection } from "./WebAppSection";
import { ClaudeFolderSection } from "./ClaudeFolderSection";
import { LogSection } from "./LogSection";

export function SettingsView() {
  return (
    <div className="settings-view space-y-6">
      <ExternalApiSection />
      <ModelsSection />
      <DiagnosticsSection />
      <HealthSection />
      <ClaudeFolderSection />
      <ImportSection />
      <AutoImportSection />
      <DirectoryMapsSection />
      <WebAppSection />
      <LogSection />
    </div>
  );
}
