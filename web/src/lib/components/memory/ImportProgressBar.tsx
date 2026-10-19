import { hostLabel } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import { progressBarView } from "./import-finish";
import type { ImportJob } from "./import-types";

/** The running state of a real import. A preview has no bar. */
export function ImportProgressBar({ job }: { job: ImportJob | null }) {
  const s = useSettingsText();
  const view = progressBarView(job);
  if (!view) return null;
  return (
    <div className="space-y-1 text-sm">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.percent}
        aria-label={s("Import progress")}
        className="h-2 w-full overflow-hidden rounded bg-muted"
      >
        <div className="h-full bg-green-600" style={{ width: `${view.percent}%` }} />
      </div>
      <p className="text-muted-foreground">
        <bdi dir="ltr">{hostLabel(view.host)}</bdi> ·{" "}
        {s(view.phase === "memory" ? "Memory units" : "Profile batches")}: {view.done} /{" "}
        {view.total} · {view.percent}%
      </p>
    </div>
  );
}
