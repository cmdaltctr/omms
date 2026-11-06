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
import type { SpaceResult } from "$lib/spaces-api";

/** The actions that ask first. Delete asks for the typed name in its own dialog. */
export type ConfirmKind = "switch" | "archive" | "restore" | "backup";
export type ConfirmRequest = { kind: ConfirmKind; id: string; name: string };

// The confirm button and the progress line reuse the texts of the card actions.
const BUTTON: Record<ConfirmKind, string> = {
  switch: "spaces-action-switch",
  archive: "spaces-action-archive",
  restore: "spaces-action-restore",
  backup: "spaces-action-backup",
};
const WORKING: Record<ConfirmKind, string> = {
  switch: "spaces-switching",
  archive: "spaces-archiving",
  restore: "spaces-restoring",
  backup: "spaces-backing-up",
};

/**
 * Asks before an action that changes a space: what it will do, then Cancel or confirm. It shows
 * progress while the request runs. A server error shows here and the dialog stays open. A
 * success closes it. Mount it only while a request is pending, so each use starts fresh.
 */
export function SpaceConfirmDialog({
  request,
  onConfirm,
  onClose,
}: {
  request: ConfirmRequest;
  /** Sends the request. The page shows its own feedback line when it ends. */
  onConfirm: (request: ConfirmRequest) => Promise<SpaceResult>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const { kind, name } = request;

  async function confirm() {
    setRunning(true);
    setError("");
    const result = await onConfirm(request);
    setRunning(false);
    if (result.success) onClose();
    else setError(result.error ?? "");
  }

  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <bdi>{t(`spaces-confirm-${kind}-title`, { name })}</bdi>
          </DialogTitle>
          <DialogDescription>{t(`spaces-confirm-${kind}-body`)}</DialogDescription>
        </DialogHeader>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        {running ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t(WORKING[kind], { name })}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={running} onClick={onClose}>
            {t("spaces-cancel")}
          </Button>
          <Button type="button" disabled={running} onClick={() => void confirm()}>
            {t(BUTTON[kind])}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
