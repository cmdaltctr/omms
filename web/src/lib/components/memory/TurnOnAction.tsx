import { useState } from "react";
import { Loader, Power } from "lucide-react";
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

/**
 * The Turn on button of the Off state. Turning automatic import on starts paid model calls on
 * every host, so it asks first. Nothing is saved until the user confirms. The save's result
 * shows in the status header's message line.
 */
export function TurnOnAction({
  disabled,
  onConfirm,
}: {
  disabled: boolean;
  onConfirm: () => Promise<void>;
}) {
  const s = useSettingsText();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button type="button" disabled={disabled} onClick={() => setAsking(true)}>
        <Power aria-hidden="true" />
        {s("Turn on")}
      </Button>
      {asking && <TurnOnDialog onConfirm={onConfirm} onClose={() => setAsking(false)} />}
    </>
  );
}

/**
 * The question before automatic import turns on. The Turn on button and the settings
 * checkbox both use it. Mount it only while the question is open.
 */
export function TurnOnDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const s = useSettingsText();
  const [running, setRunning] = useState(false);

  async function confirm() {
    setRunning(true);
    await onConfirm();
    setRunning(false);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s("Turn on automatic import?")}</DialogTitle>
          <DialogDescription>
            {s("Automatic import will run for every host, not just this one.")}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">{s("It makes model calls, which can cost money.")}</p>
        {running && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {s("Saving…")}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" autoFocus disabled={running} onClick={onClose}>
            {s("Cancel")}
          </Button>
          <Button type="button" disabled={running} onClick={() => void confirm()}>
            {s("Turn on")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
