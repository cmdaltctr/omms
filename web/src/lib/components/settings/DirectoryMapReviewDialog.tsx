import { useState } from "react";
import { defaultTicks, NO_DIRECTORY, type DirectoryMapReview } from "$lib/directory-maps";
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
import { confidenceLabel, ignoreReasonLabel } from "./DirectoryMapLabels";

type Props = {
  host: WebHost;
  review: DirectoryMapReview;
  busy: boolean;
  canConfirm: boolean;
  onRefresh: () => void;
  error: string;
  onClose: () => void;
  onConfirm: (ticked: Set<string>) => void;
};

/** Display a proposal with its own ticks; the section owns drafts and persistence. */
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
  // Ticks belong to one review; a new review starts again from the default ticks.
  const [state, setState] = useState(() => ({ review, ticked: defaultTicks(review) }));
  const ticked = state.review === review ? state.ticked : defaultTicks(review);
  const toggle = (key: string, on: boolean) =>
    setState((previous) => {
      const next = new Set(previous.review === review ? previous.ticked : defaultTicks(review));
      if (on) next.add(key);
      else next.delete(key);
      return { review, ticked: next };
    });
  const items = [
    ...review.maps.map((map) => map.from),
    ...review.ignores.map((item) => item.directory),
  ];
  const tickedCount = items.filter((key) => ticked.has(key)).length;
  const sessions = (count: number) => (
    <div className="text-xs text-muted-foreground">
      {s("Sessions")}: {count}
    </div>
  );
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
              "Tick the maps and ignores to keep, then press Confirm to save them. Saved maps apply to every host on the next import or backfill run."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto space-y-4">
          <p className="text-sm">
            {s("Proposed maps")}: {review.maps.length} · {s("Suggested to ignore")}:{" "}
            {review.ignores.length} · {s("No target")}: {review.unmapped.length}
          </p>
          {!items.length && (
            <p className="text-sm">
              {s(
                "Nothing to save. Type a target in a row, or press Ignore for folders that are not projects."
              )}
            </p>
          )}
          {review.maps.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-subsection-title font-semibold">{s("Proposed maps")}</h3>
              <ul className="space-y-3">
                {review.maps.map((map) => (
                  <li
                    key={map.from}
                    className="flex min-w-0 items-start gap-2 border-t border-border pt-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      aria-label={`${s("Save this map")} ${map.from}`}
                      checked={ticked.has(map.from)}
                      disabled={busy}
                      onChange={(event) => toggle(map.from, event.target.checked)}
                    />
                    <div className="min-w-0">
                      <code dir="ltr" className="block break-all">
                        {map.from}
                      </code>
                      <div className="mt-1">
                        {s("Target directory")}:{" "}
                        <code dir="ltr" className="break-all">
                          {map.to}
                        </code>
                      </div>
                      <div className="text-xs">
                        {s("Confidence")}: {confidenceLabel(s, map.confidence)}
                      </div>
                      {sessions(map.sessions)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {review.ignores.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-subsection-title font-semibold">{s("Suggested to ignore")}</h3>
              <ul className="space-y-3">
                {review.ignores.map((item) => (
                  <li
                    key={item.directory}
                    className="flex min-w-0 items-start gap-2 border-t border-border pt-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      aria-label={`${s("Ignore")} ${item.directory}`}
                      checked={ticked.has(item.directory)}
                      disabled={busy}
                      onChange={(event) => toggle(item.directory, event.target.checked)}
                    />
                    <div className="min-w-0">
                      <code dir="ltr" className="block break-all">
                        {item.directory}
                      </code>
                      <div className="mt-1">{ignoreReasonLabel(s, item.reason)}</div>
                      {sessions(item.sessions)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {review.unmapped.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-subsection-title font-semibold">{s("No target")}</h3>
              <ul className="space-y-3">
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
                    {sessions(row.sessions)}
                  </li>
                ))}
              </ul>
            </section>
          )}
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
            disabled={busy || !canConfirm || tickedCount === 0}
            onClick={() => onConfirm(new Set(items.filter((key) => ticked.has(key))))}
          >
            {busy ? s("Saving…") : s("Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
