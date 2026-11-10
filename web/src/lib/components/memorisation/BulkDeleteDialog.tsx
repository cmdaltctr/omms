import { useState } from "react";
import { Loader } from "lucide-react";
import { Callout } from "$lib/components/skills/Callout";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { useI18n } from "$lib/i18n";

/**
 * The one confirmation for deleting the selected memorisations. It states how many will go.
 * A failure shows here and the dialog stays open. Mount it only while the question is open.
 */
export function BulkDeleteDialog({
  count,
  onConfirm,
  onClose,
}: {
  count: number;
  /** Deletes the records. Resolves true on success. */
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    setRunning(true);
    setFailed(false);
    const done = await onConfirm();
    setRunning(false);
    if (done) onClose();
    else setFailed(true);
  }

  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("memorisation-bulk-title")}</DialogTitle>
          <DialogDescription>{t("memorisation-bulk-body", { count })}</DialogDescription>
        </DialogHeader>
        {failed ? <Callout tone="danger">{t("memorisation-bulk-failed")}</Callout> : null}
        {running ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t("memorisation-bulk-deleting")}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={running} onClick={onClose}>
            {t("memorisation-delete-cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={running}
            onClick={() => void confirm()}
          >
            {t("memorisation-delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
