import { useState, type ReactNode } from "react";
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
import { useCatalogueText } from "$lib/i18n/settings-catalogue";

/** What a confirmed request answers. A failure carries the server's reason. */
export type ConfirmResult = { success: boolean; error?: string };

/**
 * Asks before a settings change that deletes data or cannot be undone: what will happen, then
 * Cancel or confirm. Nothing is sent until the user confirms. It shows progress while the request
 * runs, shows a server error inside itself and stays open, and closes on success. Mount it only
 * while a confirmation is pending, so each use starts fresh. `title`, `body` and `confirmLabel`
 * are already translated by the card. `blocked` gives the reason the change cannot go ahead, such
 * as a count that could not be read, and keeps the confirm button off.
 */
export function SettingsConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  busyLabel,
  blocked,
  destructive = false,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<ConfirmResult>;
  onClose: () => void;
  busyLabel?: string;
  blocked?: string;
  destructive?: boolean;
}) {
  const t = useCatalogueText();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (running || blocked) return;
    setRunning(true);
    setError("");
    const result = await onConfirm();
    setRunning(false);
    if (result.success) onClose();
    else setError(result.error ?? "");
  }

  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{body}</div>
          </DialogDescription>
        </DialogHeader>
        {blocked ? <Callout tone="warning">{blocked}</Callout> : null}
        {error ? <Callout tone="danger">{error}</Callout> : null}
        {running ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {busyLabel ?? t("Saving…")}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={running} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={running || Boolean(blocked)}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
