import { useEffect, useState, type ReactNode } from "react";
import { onSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { DirectoryMapsSection } from "./DirectoryMapsSection";
import { KeywordModeSection } from "./KeywordModeSection";
import { MemorySection } from "./MemorySection";
import { MemorySwitcher } from "./MemorySwitcher";
import { ProfileCatchUpSection } from "./ProfileCatchUpSection";
import { RerankerSection } from "./RerankerSection";
import { statusText } from "./host-status";
import { sharedSummaries, type SharedSettings } from "./shared-summary";
import type { HostStatuses } from "./use-host-statuses";

/** A Shared row: a disclosure with a title and one line of state, holding the existing section. */
function SharedRow({
  id,
  title,
  summary,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      data-shared-row
      className="scroll-mt-20 rounded-xl border border-border bg-card"
    >
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl p-4 focus-visible:outline-2 focus-visible:outline-ring">
        <h2 className="text-subsection-title font-semibold">{title}</h2>
        <span className="min-w-0 break-words text-xs text-muted-foreground">{summary}</span>
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

/** `/memory/shared`: the settings that apply to every host, one row each. */
export function SharedView({
  statuses,
  onReanalyse,
}: {
  statuses: HostStatuses;
  onReanalyse: () => void;
}) {
  const s = useSettingsText();
  const [settings, setSettings] = useState<SharedSettings>();
  const [maps, setMaps] = useState<{ saved: number; ignored: number }>();
  useEffect(() => {
    let active = true;
    const load = () => {
      void settingsRequest<{ settings: SharedSettings }>("/api/settings")
        .then((value) => active && setSettings(value.settings))
        .catch(() => {});
      void settingsRequest<{ saved: unknown[]; ignored?: string[] }>("/api/settings/import-maps")
        .then(
          (value) =>
            active && setMaps({ saved: value.saved.length, ignored: value.ignored?.length ?? 0 })
        )
        .catch(() => {});
    };
    load();
    const stop = onSettingsSnapshot(load);
    return () => {
      active = false;
      stop();
    };
  }, []);
  const summary = sharedSummaries(settings, maps);
  const line = (key: keyof typeof summary) => statusText(s, summary[key]);
  return (
    <div className="space-y-6">
      <MemorySwitcher current="shared" statuses={statuses} />
      <header className="space-y-1">
        <h2 className="text-page-title font-semibold">{s("Shared")}</h2>
        <p className="text-sm text-muted-foreground">
          {s("These settings apply to every host. Open a row to change it.")}
        </p>
      </header>
      <div className="space-y-3">
        <SharedRow id="shared-profile" title={s("Profile learning")} summary={line("profile")}>
          <ProfileCatchUpSection onReanalyse={onReanalyse} />
        </SharedRow>
        <SharedRow id="shared-limits" title={s("Memory limits")} summary={line("limits")}>
          <MemorySection />
        </SharedRow>
        <SharedRow id="shared-keywords" title={s("Keyword matching")} summary={line("keywords")}>
          <KeywordModeSection />
        </SharedRow>
        <SharedRow id="shared-reranker" title={s("Reranker")} summary={line("reranker")}>
          <RerankerSection />
        </SharedRow>
        <SharedRow id="shared-directory-maps" title={s("Directory maps")} summary={line("maps")}>
          <DirectoryMapsSection hosts={[]} />
        </SharedRow>
      </div>
    </div>
  );
}
