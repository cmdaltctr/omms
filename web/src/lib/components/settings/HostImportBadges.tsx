import { useEffect, useState } from "react";
import {
  importStatusBadge,
  type BackfillHost,
  type BackfillStatusView,
  type ImportRunView,
} from "$lib/auto-import-settings";
import { hostLabel } from "$lib/host-label";
import { latestReply } from "$lib/latest-reply";
import { onSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { ImportStatusBadge } from "./ImportStatusBadge";

const HOSTS: BackfillHost[] = ["pi", "opencode", "claude-code"];

/** One small box per host saying whether its history is imported. */
export function HostImportBadges() {
  const s = useSettingsText();
  const [rows, setRows] = useState<Partial<Record<BackfillHost, BackfillStatusView>>>({});
  const [runs, setRuns] = useState<Partial<Record<BackfillHost, { run: ImportRunView }>>>({});
  useEffect(() => {
    // The 10 s poll and snapshot reloads overlap; only the newest reply counts.
    const applyRows = latestReply(setRows);
    const applyRuns = latestReply(setRuns);
    const load = () => {
      void applyRows(
        settingsRequest<Record<BackfillHost, BackfillStatusView>>("/api/settings/backfill")
      );
      void applyRuns(
        settingsRequest<Record<BackfillHost, { run: ImportRunView }>>("/api/settings/backfill/runs")
      );
    };
    load();
    const timer = setInterval(load, 10_000);
    // A save such as Ignore can change the unresolved counts the server reports.
    const unsubscribe = onSettingsSnapshot(load);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);
  return (
    <div className="flex flex-wrap gap-2" aria-label={s("Import status")}>
      {HOSTS.map((host) => (
        <div
          key={host}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm"
        >
          <span className="font-medium">{hostLabel(host)}</span>
          <ImportStatusBadge
            host={host}
            badge={importStatusBadge(rows[host] ?? null, runs[host]?.run ?? null)}
          />
        </div>
      ))}
    </div>
  );
}
