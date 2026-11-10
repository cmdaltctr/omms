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
import type { Memorisation } from "$lib/memorisation-model";

/**
 * Asks before a memorisation is deleted. It shows progress while the request runs. A failure
 * shows here and the dialog stays open. A success closes it. Mount it only while one record waits.
 */
export function DeleteMemorisationDialog({
  item,
  onConfirm,
  onClose,
}: {
  item: Memorisation;
  /** Deletes the record. Resolves true on success. */
  onConfirm: (item: Memorisation) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    setRunning(true);
    setFailed(false);
    const done = await onConfirm(item);
    setRunning(false);
    if (done) onClose();
    else setFailed(true);
  }

  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <bdi>{t("memorisation-delete-title", { id: item.id })}</bdi>
          </DialogTitle>
          <DialogDescription>{t("memorisation-delete-body")}</DialogDescription>
        </DialogHeader>
        {failed ? (
          <Callout tone="danger">{t("memorisation-delete-failed", { id: item.id })}</Callout>
        ) : null}
        {running ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t("memorisation-deleting", { id: item.id })}
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
