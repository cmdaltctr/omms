import { hostLabel } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import { fill } from "$lib/skills-model";
import { progressBarView } from "./import-finish";
import type { ImportJob } from "./import-types";

// Plain words for the bar; the exact counters (memory units, profile batches) stay in Details.
const PHASE_LABEL = {
  memory: "Saving memories",
  "skill-turns": "Skill turns",
  profile: "Learning your profile",
} as const;

/**
 * The running state of a real import. A preview has no bar. `minutesLeft` comes from the active
 * host's run record; it is null or missing until that record has measured a rate.
 */
export function ImportProgressBar({
  job,
  minutesLeft,
}: {
  job: ImportJob | null;
  minutesLeft?: number | null;
}) {
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
        <bdi dir="ltr">{hostLabel(view.host)}</bdi> · {s(PHASE_LABEL[view.phase])}
        {/* The counts wait for the first one, so the line never reads "0 / 0 · 0%". */}
        {view.total > 0 && (
          <>
            : {view.done} / {view.total} · {view.percent}% ·{" "}
            {typeof minutesLeft === "number"
              ? fill(s("About {minutes} min left"), { minutes: minutesLeft })
              : s("Time left: not known yet")}
          </>
        )}
      </p>
    </div>
  );
}
