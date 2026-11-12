import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { fetchAPI } from "$lib/api";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { useI18n } from "$lib/i18n";
import { tagMigrationFailure, type TagMigrationResult } from "$lib/tag-migration-result";

type Props = {
  open?: boolean;
  count?: number;
  onOpenChange?: (open: boolean) => void;
  onComplete?: () => void;
};

export function TagMigrationDialog({ open = false, count = 0, onOpenChange, onComplete }: Props) {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  // Null shows the starting message, in the current language.
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  // The reply of a run that left memories untagged. The dialog stays open and says why.
  // The reply is kept, not its words, so a language change translates it again.
  const [failedRun, setFailedRun] = useState<TagMigrationResult | null>(null);
  const failure = failedRun ? tagMigrationFailure(failedRun, t) : null;

  // Reset only when the dialog opens or the count changes. The end of a run or a language
  // change must not reset it, or a failure message would vanish.
  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setProgress(0);
    setFailedRun(null);
  }, [open, count]);

  function handleOpenChange(next: boolean) {
    if (running && !next) return;
    onOpenChange?.(next);
  }

  async function runTagMigration() {
    setRunning(true);
    setFailedRun(null);
    setStatus(t("status-migration-init"));
    setProgress(0);

    let hasMore = true;
    let attempts = 0;
    let last: TagMigrationResult | null = null;
    const maxAttempts = 1000;

    while (hasMore && attempts < maxAttempts) {
      attempts++;
      const result = await fetchAPI<TagMigrationResult>("/api/migration/tags/run-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize: 3 }),
      });

      if (!result.success || !result.data) {
        setStatus(t("toast-migration-failed") + ": " + (result.error || ""));
        setRunning(false);
        return;
      }

      last = result.data;
      const processed = result.data.processed;
      hasMore = result.data.hasMore;
      const total = result.data.total;
      setProgress(total > 0 ? Math.round((processed / total) * 100) : 0);
      setStatus(t("status-migration-progress", { current: processed, total }));
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    if (attempts >= maxAttempts) {
      setStatus(t("migration-stopped"));
      setRunning(false);
      return;
    }

    if (last && tagMigrationFailure(last, t)) {
      // Not a success: keep the dialog open with the reason and a Try again button.
      setFailedRun(last);
      setRunning(false);
      return;
    }

    setProgress(100);
    setStatus(t("toast-migration-success"));
    toast.success(t("toast-migration-success"));
    setTimeout(() => {
      setRunning(false);
      handleOpenChange(false);
      onComplete?.();
    }, 2000);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={!running}>
        <DialogHeader>
          <DialogTitle>{t("modal-migration-title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {failure ? (
            <div role="alert" className="space-y-1 text-sm text-destructive">
              <p>{failure.message}</p>
              {failure.reason ? <p className="text-xs break-words">{failure.reason}</p> : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" role="status">
              {status ?? t("migration-found-tags", { count })}
            </p>
          )}
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("tag-migration-cost")}</p>
          <p className="text-xs text-muted-foreground">{t("migration-note")}</p>
        </div>
        {!running ? (
          <DialogFooter>
            <Button onClick={runTagMigration}>
              <Play className="size-3.5" />
              {failure ? t("tag-migration-retry") : t("btn-start-migration")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
