import { useEffect, useRef, useState } from "react";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { useSettingsText } from "$lib/i18n/settings";
import { fill } from "$lib/skills-model";
import { classifyEnd, failureReason, readDismissedEnd, writeDismissedEnd } from "./import-finish";
import { importSummary } from "./import-summary";
import type { ImportJob } from "./import-types";
import { importFeedback, ImportResults } from "./ImportResults";

/**
 * The result of a finished real import, shared by the dialog and the banner: three plain lines,
 * Retry failed when something failed, and a closed Details section with the counters.
 */
export function FinishBody({ job, onRetry }: { job: ImportJob; onRetry?: () => void }) {
  const s = useSettingsText();
  const summary = importSummary(job);
  const stopped = job.state === "failed";
  const reason = failureReason(job);
  const canRetry = onRetry !== undefined && (summary.failed || stopped);
  // Each line says only what is true: no profile line when the step did not run or recorded
  // nothing, and no "Failed: 0" when the import stopped for another reason.
  const profileLine = summary.profileFailed
    ? s("Profile learning failed")
    : summary.profilePrompts > 0
      ? summary.profilePrompts === 1
        ? s("Profile updated from 1 prompt")
        : fill(s("Profile updated from {n} prompts"), { n: summary.profilePrompts })
      : null;
  const failedLine =
    summary.failedUnits > 0
      ? fill(s("Failed: {n}"), { n: summary.failedUnits })
      : stopped
        ? reason
          ? null
          : s("The import stopped before it finished.")
        : summary.profileFailed
          ? null
          : s("Nothing failed.");
  return (
    <div className="min-w-0 space-y-3 text-sm">
      {stopped && reason && <p role="alert">{importFeedback(reason, s)}</p>}
      <ul className="space-y-1">
        <li>{fill(s("Memories saved: {n}"), { n: summary.saved })}</li>
        {profileLine && <li>{profileLine}</li>}
        {failedLine && <li>{failedLine}</li>}
      </ul>
      {canRetry && (
        <>
          <p className="text-muted-foreground">
            {s(
              summary.failed
                ? "Some work did not finish. Retry failed tries only that work."
                : "Check the model settings, then select Retry failed."
            )}
          </p>
          <Button variant="outline" onClick={onRetry}>
            {s("Retry failed")}
          </Button>
        </>
      )}
      <details className="min-w-0 rounded-lg border border-border p-3">
        <summary className="cursor-pointer rounded font-medium focus-visible:outline-2 focus-visible:outline-ring">
          {s("Details")}
        </summary>
        <div className="mt-3 min-w-0">
          <ImportResults job={job} />
        </div>
      </details>
    </div>
  );
}

/**
 * Announces the end of a real import: a dialog when the run ends on the page, a
 * banner when it ended before the page opened, and an inline note when it was
 * cancelled. OK or Dismiss remembers the run, so it is not announced again.
 */
export function ImportFinish({
  job,
  onReload,
  onRetry,
}: {
  job: ImportJob | null;
  onReload: () => void;
  /** Starts the same preview and confirm flow as the primary button, for the same hosts. */
  onRetry?: () => void;
}) {
  const s = useSettingsText();
  const previous = useRef<ImportJob | null>(null);
  const [shown, setShown] = useState<{ job: ImportJob; view: "dialog" | "banner" } | null>(null);
  useEffect(() => {
    if (!job) return;
    const view = classifyEnd(previous.current, job, readDismissedEnd());
    previous.current = job;
    if (view !== "none") setShown({ job, view: view });
  }, [job]);

  const close = () => {
    if (shown) writeDismissedEnd(shown.job.id);
    setShown(null);
  };
  const retry = onRetry
    ? () => {
        close();
        onRetry();
      }
    : undefined;
  const title = shown
    ? s(shown.job.state === "failed" ? "Import failed" : "Import successful 🎉")
    : "";
  return (
    <>
      {job?.state === "cancelled" && !job.dryRun && (
        <p role="status" className="text-sm text-muted-foreground">
          {s("Import cancelled")}
        </p>
      )}
      {shown?.view === "banner" && (
        <div
          role="status"
          className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-card p-3"
        >
          <div className="space-y-1">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">
              {s("The import finished while you were away.")}
            </p>
            <FinishBody job={shown.job} onRetry={retry} />
          </div>
          <Button variant="outline" size="sm" onClick={close}>
            {s("Dismiss")}
          </Button>
        </div>
      )}
      <Dialog
        open={shown?.view === "dialog"}
        onOpenChange={(open) => {
          if (open) return;
          close();
          onReload();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className={shown?.job.state === "failed" ? "border-destructive/40" : undefined}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">{title}</DialogDescription>
          </DialogHeader>
          {shown && <FinishBody job={shown.job} onRetry={retry} />}
          <DialogFooter>
            <Button
              autoFocus
              onClick={() => {
                close();
                onReload();
              }}
            >
              {s("OK")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
