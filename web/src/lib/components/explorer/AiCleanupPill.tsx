import { useEffect } from "react";
import { CircleAlert, CircleCheck, Loader } from "lucide-react";
import { useAiCleanupJob } from "@/hooks/useAiCleanupJob";
import { pillView } from "./ai-cleanup-job-state";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";
import { cn } from "$lib/utils";

type Props = {
  /** Opens the AI Cleanup dialog again. */
  onOpen: () => void;
  /** Called when a read finds no job, so there is nothing left to show. */
  onGone: () => void;
};

/** A minimised AI Cleanup dialog. It follows the job until the user opens the dialog again. */
export function AiCleanupPill({ onOpen, onGone }: Props) {
  const { t } = useI18n();
  const cleanup = useAiCleanupJob(true, true);
  const view = pillView(cleanup.job, cleanup.checked);
  const gone = view === null;

  useEffect(() => {
    if (gone) onGone();
  }, [gone, onGone]);

  if (!view) return null;

  const failed = view.kind === "failed";
  const label =
    view.kind === "running"
      ? view.total > 0
        ? t("label-ai-cleanup-pill-progress", { done: view.done, total: view.total })
        : t("label-ai-cleanup-pill-running")
      : view.kind === "ready"
        ? t("label-ai-cleanup-pill-ready")
        : failed
          ? t("label-ai-cleanup-pill-failed")
          : t("label-ai-cleanup-pill");

  return (
    <div className="fixed top-3 end-3 z-40 max-w-[calc(100%-1.5rem)]" role="status">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onOpen}
        className={cn(
          "max-w-full bg-popover shadow-md",
          failed && "border-destructive text-destructive hover:text-destructive"
        )}
      >
        {view.kind === "ready" ? (
          <CircleCheck aria-hidden="true" />
        ) : failed ? (
          <CircleAlert aria-hidden="true" />
        ) : (
          <Loader aria-hidden="true" className="animate-spin" />
        )}
        <span className="truncate">{label}</span>
      </Button>
    </div>
  );
}
