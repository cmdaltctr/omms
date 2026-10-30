import {
  importStatusBadge,
  lastRunSummary,
  progressView,
  showsExchangeProgress,
  type ImportRunView,
} from "$lib/auto-import-settings";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import { formatDate } from "$lib/format";
import { navigate } from "$lib/router";
import { memoryPath } from "$lib/routes";
import type { BackfillRow } from "./use-backfill";

/**
 * The facts behind a host's status: progress, the profile phase, the last run,
 * counts, model, cutoff and any stored error. Everything here is read-only.
 */
export function HostRunDetails({
  host,
  run,
  row,
}: {
  host: WebHost;
  run: ImportRunView;
  row: BackfillRow;
}) {
  const s = useSettingsText();
  const progress = showsExchangeProgress(run) ? progressView(run) : null;
  const summary = lastRunSummary(run);
  const badge = importStatusBadge(row, run);
  const target = `${memoryPath(host)}#host-unresolved`;
  return (
    <div className="space-y-2 text-sm">
      {badge.kind === "learning-profile" && (
        <p className="text-muted-foreground">
          {s("All exchanges are done. Learning the profile from the imported prompts")}:{" "}
          {badge.done} / {badge.total} {s("batches")}
        </p>
      )}
      {progress && (
        <div className="space-y-1">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
            aria-label={s("Import progress")}
            className="h-2 w-full overflow-hidden rounded bg-muted"
          >
            <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="text-muted-foreground">
            {progress.percent}% · {progress.done} · {s("Minutes left")}:{" "}
            {progress.minutesLeft === "unknown"
              ? s("unknown")
              : progress.minutesLeft.replace("about", s("about"))}
          </p>
        </div>
      )}
      {run?.state === "running" && run.surface && (
        <p className="text-muted-foreground">{s(`started from ${run.surface}`)}</p>
      )}
      {summary && (
        <p className="text-muted-foreground">
          {s("Last run")}: {formatDate(summary.finishedAt)} · {s(`started from ${summary.surface}`)}{" "}
          · {s(summary.state)} · {s("Imported")}: {summary.imported} · {s("Skipped")}:{" "}
          {summary.skipped} · {s("Failed")}: {summary.failed}
        </p>
      )}
      {row && (
        <div className="space-y-1 text-muted-foreground">
          {!summary && (
            <p>
              {s("Imported")}: {row.counts.imported} · {s("Skipped")}: {row.counts.skipped} ·{" "}
              {s("Failed")}: {row.counts.failed}
            </p>
          )}
          <p>
            {s("Pending")}: {row.counts.pending} · {s("Unresolved sessions")}:{" "}
            {row.counts.unresolved}
            {row.counts.unresolved > 0 && (
              <>
                {" "}
                <a
                  className="underline focus-visible:outline-2 focus-visible:outline-ring"
                  href={target}
                  aria-label={`${hostLabel(host)}: ${s("Resolve missing project folders")}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(target);
                  }}
                >
                  {s("Resolve missing project folders")}
                </a>
              </>
            )}
          </p>
          <p>
            {s("Model")}: <bdi dir="ltr">{row.model ?? s("none")}</bdi>
          </p>
          <p>
            {s("Cutoff")}: {formatDate(row.cutoff)}
          </p>
          {row.error && <p role="alert">{row.error}</p>}
        </div>
      )}
    </div>
  );
}
