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
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { useI18n } from "$lib/i18n";
import type { DeleteDone, SpaceResult, SpaceRow } from "$lib/spaces-api";

/**
 * Delete needs the exact display name. OMMS backs the space up first, then removes it, so the
 * dialog shows progress while that runs and the backup location when it ends.
 */
export function SpaceDeleteDialog({
  space,
  onDelete,
  onClose,
}: {
  /** The space to delete, or null while the dialog is shut. */
  space: SpaceRow | null;
  /** `confirmName` is the text the user typed; the server compares it with the name too. */
  onDelete: (space: SpaceRow, confirmName: string) => Promise<SpaceResult<DeleteDone>>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<DeleteDone | null>(null);
  const name = space?.name ?? "";

  function close() {
    setTyped("");
    setError("");
    setDone(null);
    onClose();
  }

  async function confirm() {
    if (!space || typed !== space.name) return;
    setRunning(true);
    setError("");
    const result = await onDelete(space, typed);
    setRunning(false);
    if (result.success && result.data) setDone(result.data);
    else setError(result.error ?? "");
  }

  return (
    <Dialog open={space !== null} onOpenChange={(open) => (open || running ? undefined : close())}>
      <DialogContent>
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("spaces-deleted-title", { name })}</DialogTitle>
              <DialogDescription>{t("spaces-delete-restore")}</DialogDescription>
            </DialogHeader>
            <div className="min-w-0 space-y-1 text-sm">
              <p>{t("spaces-delete-backup")}</p>
              <p
                dir="ltr"
                className="break-all rounded-lg bg-secondary px-2 py-1 font-mono text-xs"
              >
                {done.backup.path}
              </p>
            </div>
            {done.leftoverFolder ? (
              <Callout tone="warning">
                <p>{t("spaces-delete-leftover")}</p>
                <p dir="ltr" className="break-all font-mono text-xs">
                  {done.leftoverFolder}
                </p>
              </Callout>
            ) : null}
            <DialogFooter>
              <Button type="button" onClick={close}>
                {t("spaces-close")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                <bdi>{t("spaces-delete-title", { name })}</bdi>
              </DialogTitle>
              <DialogDescription>{t("spaces-delete-warning")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="space-delete-name">
                {t("spaces-delete-confirm-label", { name })}
              </Label>
              <Input
                id="space-delete-name"
                value={typed}
                disabled={running}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
            {error ? <Callout tone="danger">{error}</Callout> : null}
            {running ? (
              <p role="status" className="flex items-center gap-2 text-muted-foreground">
                <Loader className="size-4 animate-spin" aria-hidden="true" />
                {t("spaces-deleting", { name })}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={running} onClick={close}>
                {t("spaces-cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={typed !== name || running}>
                {t("spaces-delete-button")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
