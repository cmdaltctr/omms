import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import type { SuggestedDirectory } from "$lib/directory-maps";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";

/** Lists every directory that Ignore all will leave unimported, before anything is saved. */
export function IgnoreAllDialog({
  host,
  rows,
  busy,
  onConfirm,
  onCancel,
}: {
  host: WebHost;
  rows: SuggestedDirectory[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const s = useSettingsText();
  const sessions = rows.reduce((sum, row) => sum + row.sessions, 0);
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{`${s("Ignore all")}: ${hostLabel(host)}`}</DialogTitle>
          <DialogDescription>
            {`${s("These directories stay unimported and leave the unresolved counts.")} ${s("Directories")}: ${rows.length} · ${s("Sessions")}: ${sessions}`}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
          {rows.map((row) => (
            <li key={row.directory} className="flex min-w-0 items-start gap-2">
              <code dir="ltr" className="min-w-0 flex-1 break-all">
                {row.directory}
              </code>
              <span className="shrink-0 text-muted-foreground">{row.sessions}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {s("Cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>
            {s("Ignore all")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
