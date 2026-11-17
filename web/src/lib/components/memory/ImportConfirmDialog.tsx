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
import { hostLabel, type WebHost } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import { fill } from "$lib/skills-model";
import type { ImportEstimate } from "./import-estimate";
import { importFeedback } from "./ImportResults";

/**
 * The last step before an import that can cost money. It states the sessions, the hosts, the
 * estimated model calls and time, and whether imported chats are skipped or analysed again. Cancel has the focus.
 * A server error shows here and the dialog stays open. Mount it only while the question is
 * open, so each use starts fresh.
 */
export function ImportConfirmDialog({
  estimate,
  hosts,
  force = false,
  onConfirm,
  onClose,
}: {
  estimate: ImportEstimate;
  hosts: WebHost[];
  /** A re-analyse: chats already imported are analysed again, not skipped. */
  force?: boolean;
  /** Starts the import. Resolves null once it started, or the server's reason when it did not. */
  onConfirm: () => Promise<string | null>;
  onClose: () => void;
}) {
  const s = useSettingsText();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setRunning(true);
    setError("");
    const reason = await onConfirm().catch((failure: unknown) =>
      failure instanceof Error ? failure.message : String(failure)
    );
    setRunning(false);
    if (reason === null) onClose();
    else setError(reason);
  }

  // The reason sits inside a translated sentence, so split the sentence around its slot.
  const [before, after = ""] = s("The import did not start: {reason}").split("{reason}");
  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s("Import chats?")}</DialogTitle>
          <DialogDescription>
            {s("OMMS sends parts of these chats to your model. This can cost money.")}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm">
          <li>{fill(s("Sessions to import: {sessions}"), { sessions: estimate.sessions })}</li>
          <li>{fill(s("From: {hosts}"), { hosts: hosts.map(hostLabel).join(", ") })}</li>
          <li>{fill(s("Model calls: about {calls}"), { calls: estimate.calls })}</li>
          <li>
            {estimate.minutes === null
              ? s("The time is known once the import starts.")
              : fill(s("Time: about {minutes} min"), { minutes: estimate.minutes })}
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">{s("These numbers are estimates.")}</p>
        <p className="text-sm">
          {force
            ? s("Chats already imported are analysed again. This can cost more model calls.")
            : s("Chats already imported are skipped, so running an import again is safe.")}
        </p>
        {error ? (
          <Callout tone="danger">
            {before}
            {importFeedback(error, s)}
            {after}
          </Callout>
        ) : null}
        {running ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {s("Starting the import…")}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" autoFocus disabled={running} onClick={onClose}>
            {s("Cancel")}
          </Button>
          <Button type="button" disabled={running} onClick={() => void confirm()}>
            {s("Import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
