import { useEffect, useState } from "react";
import {
  importStatusBadge,
  type BackfillHost,
  type BackfillStatusView,
  type ImportRunView,
} from "$lib/auto-import-settings";
import { hostLabel } from "$lib/host-label";
import { settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { ImportStatusBadge } from "./ImportStatusBadge";

const HOSTS: BackfillHost[] = ["pi", "opencode", "claude-code"];

/** One small box per host saying whether its history is imported. */
export function HostImportBadges() {
  const s = useSettingsText();
  const [rows, setRows] = useState<Partial<Record<BackfillHost, BackfillStatusView>>>({});
  const [runs, setRuns] = useState<Partial<Record<BackfillHost, { run: ImportRunView }>>>({});
  useEffect(() => {
    const load = () => {
      void settingsRequest<Record<BackfillHost, BackfillStatusView>>("/api/settings/backfill")
        .then(setRows)
        .catch(() => {});
      void settingsRequest<Record<BackfillHost, { run: ImportRunView }>>(
        "/api/settings/backfill/runs"
      )
        .then(setRuns)
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
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
            badge={importStatusBadge(rows[host] ?? null, runs[host]?.run ?? null)}
          />
        </div>
      ))}
    </div>
  );
}
