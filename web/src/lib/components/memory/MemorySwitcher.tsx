import { MEMORY_VIEWS, type MemoryViewId } from "$lib/routes";
import { useSettingsText } from "$lib/i18n/settings";
import { useWriteHealth } from "$lib/write-health-store";
import { HostCard } from "./HostCard";
import { statusText, type StatusText } from "./host-status";
import type { HostStatuses } from "./use-host-statuses";

/** The four cards at the top of every view, so one click reaches any other view. */
export function MemorySwitcher({
  current,
  statuses,
}: {
  current: MemoryViewId;
  statuses: HostStatuses;
}) {
  const s = useSettingsText();
  const { health } = useWriteHealth();
  const failing = health && !health.ok ? (health.reason ?? "") : null;
  return (
    <nav aria-label={s("Memory views")}>
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {MEMORY_VIEWS.map((view) => {
          const host = view === "shared" ? null : view;
          const line: StatusText = host ? statuses.line(host) : { text: "Every host" };
          return (
            <li key={view} className="min-w-0">
              <HostCard
                compact
                view={view}
                current={view === current}
                line={statusText(s, line)}
                // A host that is not set up does not write memories, so it says so instead.
                warning={host && statuses.input(host).setUp ? failing : null}
                notSetUp={host ? !statuses.input(host).setUp : false}
              />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
