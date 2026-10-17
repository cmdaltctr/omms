import { useState } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { autoCleanupApi } from "$lib/api";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { formatDate } from "$lib/format";
import { useI18n } from "$lib/i18n";
import { useAutoCleanupRecord } from "@/hooks/useAutoCleanupRecord";
import {
  confirmationParams,
  nextUndoPhase,
  shouldCallUndo,
  showUndoButton,
  undoMessage,
  type UndoPhase,
} from "./auto-cleanup-undo-state";

type Props = {
  /** The profile version. The newest record is read again when it changes. */
  version?: number;
  /** Called after an undo, so the page loads the restored profile. */
  onUndone?: () => void;
};

/** The Undo last automatic cleanup button of the Profile page, with its confirmation. */
export function AutoCleanupUndo({ version, onUndone }: Props) {
  const { t } = useI18n();
  const { record, reload } = useAutoCleanupRecord(version);
  const [phase, setPhase] = useState<UndoPhase>("idle");
  if (!showUndoButton(record) || !record) return null;

  async function confirm() {
    if (!shouldCallUndo(phase, "confirm")) return;
    setPhase(nextUndoPhase(phase, "confirm"));
    const result = await autoCleanupApi.undo();
    setPhase("idle");
    reload();
    if (!result.success || !result.data) {
      toast.info(result.error || t("toast-auto-cleanup-undo-failed"));
      return;
    }
    const message = undoMessage(result.data);
    toast.success(t(message.key, message.params));
    onUndone?.();
  }

  const params = confirmationParams(record);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setPhase(nextUndoPhase(phase, "open"))}>
        <Undo2 className="size-3.5" />
        {t("btn-auto-cleanup-undo")}
      </Button>
      <Dialog
        open={phase !== "idle"}
        onOpenChange={(open) => {
          if (!open) setPhase(nextUndoPhase(phase, "cancel"));
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("title-auto-cleanup-undo")}</DialogTitle>
            <DialogDescription>
              {t("label-auto-cleanup-undo-body", {
                when: formatDate(new Date(params.createdAt).toISOString()),
                merged: params.merged,
                removed: params.removed,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={phase === "working"}
              onClick={() => setPhase(nextUndoPhase(phase, "cancel"))}
            >
              {t("btn-cancel")}
            </Button>
            <Button size="sm" disabled={phase === "working"} onClick={() => void confirm()}>
              {t("btn-auto-cleanup-undo-confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
