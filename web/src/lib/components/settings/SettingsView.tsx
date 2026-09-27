import { ModelsSection } from "./ModelsSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { HealthSection } from "./HealthSection";
import { ImportSection } from "./ImportSection";
import { LogSection } from "./LogSection";

export function SettingsView() {
  return (
    <div className="space-y-6">
      <ModelsSection />
      <DiagnosticsSection />
      <HealthSection />
      <ImportSection />
      <LogSection />
    </div>
  );
}
