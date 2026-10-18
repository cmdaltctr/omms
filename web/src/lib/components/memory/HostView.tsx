import { useSettingsText } from "$lib/i18n/settings";
import { hostLabel, type WebHost } from "$lib/host-label";
import { DirectoryMapsSection } from "./DirectoryMapsSection";
import { HostSettings } from "./HostSettings";
import { HostStatusHeader } from "./HostStatusHeader";
import { ImportSection } from "./ImportSection";
import { MemorySwitcher } from "./MemorySwitcher";
import { WriteHealthStrip } from "./WriteHealthStrip";
import type { HostStatuses } from "./use-host-statuses";

/** `/memory/<host>`: only that host's state, sessions and settings, under a switcher. */
export function HostView({
  host,
  statuses,
  profilePreset,
}: {
  host: WebHost;
  statuses: HostStatuses;
  profilePreset: number;
}) {
  const s = useSettingsText();
  const notSetUp = !statuses.input(host).setUp;
  return (
    <div className="space-y-6">
      <MemorySwitcher current={host} statuses={statuses} />
      <WriteHealthStrip />
      <HostStatusHeader host={host} statuses={statuses} />
      {notSetUp ? (
        <p className="text-sm text-muted-foreground">
          {`${hostLabel(host)}: ${s("OMMS did not find this host's chat history on this computer. Install the host and use it once, then reload this page.")}`}
        </p>
      ) : (
        <>
          <ImportSection host={host} profilePreset={profilePreset} />
          <DirectoryMapsSection
            hosts={[host]}
            saved={false}
            title="Sessions that need a folder"
            anchorId="host-unresolved"
          />
          <HostSettings host={host} backfill={statuses.backfill} />
        </>
      )}
    </div>
  );
}
