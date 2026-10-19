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
import {
  classifyEnd,
  failedUnits,
  failureReason,
  readDismissedEnd,
  writeDismissedEnd,
} from "./import-finish";
import type { ImportJob } from "./import-types";
import { importFeedback, workCounts } from "./ImportResults";

/** The result of a finished real import, shared by the dialog and the banner. */
export function FinishBody({ job }: { job: ImportJob }) {
  const s = useSettingsText();
  const failed = job.state === "failed";
  const reason = failureReason(job);
  const units = failedUnits(job);
  return (
    <div className="space-y-2 text-sm">
      {failed && reason && <p role="alert">{importFeedback(reason, s)}</p>}
      {units > 0 && (
        <p>
          {s("Failed memory units")}: {units}
        </p>
      )}
      {!failed && (
        <p className="text-muted-foreground">
          {workCounts(
            {
              summary: {
                unitsImported: job.summary?.unitsImported,
                unitsFailed: job.summary?.unitsFailed ?? 0,
              },
            },
            s
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Announces the end of a real import: a dialog when the run ends on the page, a
 * banner when it ended before the page opened, and an inline note when it was
 * cancelled. OK or Dismiss remembers the run, so it is not announced again.
 */
export function ImportFinish({ job, onReload }: { job: ImportJob | null; onReload: () => void }) {
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
            <FinishBody job={shown.job} />
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
          {shown && <FinishBody job={shown.job} />}
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
