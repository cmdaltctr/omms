import { useState } from "react";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import { MEMORY_VIEWS } from "$lib/routes";
import { useWriteHealth } from "$lib/write-health-store";
import { HostCard } from "./HostCard";
import { ImportSection } from "./ImportSection";
import { statusText, type StatusText } from "./host-status";
import type { HostStatuses } from "./use-host-statuses";

/** `/memory`: one card per host and Shared, then the all-hosts import. */
export function MemoryOverview({
  statuses,
  profilePreset,
}: {
  statuses: HostStatuses;
  profilePreset: number;
}) {
  const s = useSettingsText();
  const { health } = useWriteHealth();
  const [importOpen, setImportOpen] = useState(false);
  const failing = health && !health.ok ? (health.reason ?? "") : null;
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        {s("Choose a host to see its history import, sessions and settings.")}
      </p>
      <ul className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4">
        {MEMORY_VIEWS.map((view) => {
          const host = view === "shared" ? null : view;
          const line: StatusText = host ? statuses.line(host) : { text: "Settings for every host" };
          return (
            <li key={view} className="min-w-0">
              <HostCard
                view={view}
                line={statusText(s, line)}
                // A host that is not set up does not write memories, so it says so instead.
                warning={host && statuses.input(host).setUp ? failing : null}
                notSetUp={host ? !statuses.input(host).setUp : false}
              />
            </li>
          );
        })}
      </ul>
      <section className="space-y-3" aria-label={s("Import all hosts")}>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            aria-expanded={importOpen}
            aria-controls="memory-import-all"
            onClick={() => setImportOpen((open) => !open)}
          >
            {s("Import all hosts")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {s("Runs one import for every host you tick. It makes model calls and can cost money.")}
          </p>
        </div>
        <div id="memory-import-all" hidden={!importOpen}>
          {importOpen && <ImportSection profilePreset={profilePreset} />}
        </div>
      </section>
    </div>
  );
}
