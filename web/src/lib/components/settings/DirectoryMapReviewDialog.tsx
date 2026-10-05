import type { DirectoryMapReview } from "$lib/directory-maps";
import { NO_DIRECTORY } from "$lib/directory-maps";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "$lib/components/ui/dialog";

type Props = {
  host: WebHost;
  review: DirectoryMapReview;
  busy: boolean;
  canConfirm: boolean;
  onRefresh: () => void;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
};

/** Display an immutable proposal; the section owns drafts and persistence. */
export function DirectoryMapReviewDialog({
  host,
  review,
  busy,
  canConfirm,
  onRefresh,
  error,
  onClose,
  onConfirm,
}: Props) {
  const s = useSettingsText();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-2xl flex flex-col overflow-hidden"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {s("Review directory maps")}: {hostLabel(host)}
          </DialogTitle>
          <DialogDescription>
            {s(
              "Review these maps, then press Confirm to save. Saved maps apply to every host on the next import or backfill run."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto space-y-3">
          <p className="text-sm">
            {s("Proposed maps")}: {review.maps.length} · {s("Unmapped rows")}:{" "}
            {review.unmapped.length}
          </p>
          {!review.maps.length && (
            <p className="text-sm">
              {s("No maps to save.")} {s("Choose targets for rows without suggestions.")}
            </p>
          )}
          <ul className="space-y-3">
            {review.maps.map((map) => (
              <li key={map.from} className="min-w-0 border-t border-border pt-2 text-sm">
                <code dir="ltr" className="block break-all">
                  {map.from}
                </code>
                <div className="mt-1">
                  {s("Target directory")}:{" "}
                  <code dir="ltr" className="break-all">
                    {map.to}
                  </code>
                </div>
                <div className="text-xs text-muted-foreground">
                  {s("Sessions")}: {map.sessions}
                </div>
              </li>
            ))}
            {review.unmapped.map((row, index) => (
              <li
                key={`${row.directory}-${index}`}
                className="min-w-0 border-t border-border pt-2 text-sm"
              >
                {row.directory === NO_DIRECTORY ? (
                  s("No directory recorded")
                ) : (
                  <code dir="ltr" className="block break-all">
                    {row.directory}
                  </code>
                )}
                <div>
                  {row.directory === NO_DIRECTORY
                    ? s("These sessions cannot be mapped.")
                    : s("No target chosen")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s("Sessions")}: {row.sessions}
                </div>
              </li>
            ))}
          </ul>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {s("Cancel")}
          </Button>
          {!canConfirm && (
            <Button type="button" variant="outline" disabled={busy} onClick={onRefresh}>
              {s("Refresh list")}
            </Button>
          )}
          <Button
            type="button"
            disabled={busy || !canConfirm || !review.maps.length}
            onClick={onConfirm}
          >
            {busy ? s("Saving…") : s("Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
