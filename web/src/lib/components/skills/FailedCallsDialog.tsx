import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { formatDate } from "$lib/format";
import { useSettingsText } from "$lib/i18n/settings";
import { fill } from "$lib/skills-model";
import type { FailedCall, FailureGroupCall } from "$lib/skills-api";

/** The dialog shows at most this many input characters before Show full input. */
export const INPUT_PREVIEW_CHARS = 400;

/** Any failed call the dialog lists: a turn's call, or a group call with its turn's time. */
export type DialogFailure = FailedCall | FailureGroupCall;

/** The plain text the Copy button writes: tool name, error text and input. */
export function callText(call: DialogFailure): string {
  return [
    `Tool: ${call.name}`,
    `Error: ${call.error ?? "(no error text recorded)"}`,
    `Input: ${call.input}`,
  ].join("\n");
}

function FailureCard({ call }: { call: DialogFailure }) {
  const s = useSettingsText();
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const long = call.input.length > INPUT_PREVIEW_CHARS;
  const shown = long && !full ? call.input.slice(0, INPUT_PREVIEW_CHARS) + "…" : call.input;
  async function copy() {
    try {
      await navigator.clipboard.writeText(callText(call));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The browser refused the clipboard; the button stays as it was.
    }
  }
  return (
    <div className="min-w-0 space-y-1.5 rounded-xl border border-border bg-card px-3 py-2.5">
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-mono" dir="ltr">
          {call.name}
        </span>
        <span dir="ltr">{fill(s("Position {position}"), { position: call.position })}</span>
        {"createdAt" in call ? <span>{formatDate(call.createdAt)}</span> : null}
        {"projectName" in call && call.projectName ? <bdi>{call.projectName}</bdi> : null}
      </p>
      <p className="break-words text-sm" dir="auto">
        {call.error ?? <span className="text-muted-foreground">{s("No error text recorded")}</span>}
      </p>
      <pre
        dir="ltr"
        className="max-h-64 overflow-y-auto rounded-lg bg-secondary px-2.5 py-2 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        {shown}
      </pre>
      {call.inputCut ? (
        <p className="text-xs text-muted-foreground">
          {s("The server sent the first 20000 characters of this input.")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {long ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setFull((value) => !value)}
          >
            {full ? s("Show less input") : s("Show full input")}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          <span role="status">{copied ? s("Copied") : s("Copy")}</span>
        </Button>
      </div>
    </div>
  );
}

/**
 * One dialog for both entry points: a turn's failed calls, or a group's latest
 * calls. The caller owns the loading state; `totalCount` names the group size
 * when the calls are a group's sample.
 */
export function FailedCallsDialog({
  title,
  calls,
  totalCount,
  loading,
  loadError,
  onClose,
}: {
  title: string;
  calls: readonly DialogFailure[];
  totalCount?: number;
  loading: boolean;
  loadError: string;
  onClose: () => void;
}) {
  const s = useSettingsText();
  return (
    <Dialog open onOpenChange={(open) => void (!open && onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {totalCount !== undefined && calls.length > 0 ? (
            <DialogDescription>
              {fill(
                s(
                  totalCount === 1
                    ? "{count} call is in this group; showing the latest {shown}."
                    : "{count} calls are in this group; showing the latest {shown}."
                ),
                {
                  count: totalCount,
                  shown: calls.length,
                }
              )}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {loadError ? (
          <>
            <p role="alert" className="text-sm text-destructive-label">
              {s("The failed calls could not be loaded.")}
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {s("Close")}
              </Button>
            </DialogFooter>
          </>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">{s("Loading…")}</p>
        ) : (
          <div className="space-y-3">
            {calls.map((call) => (
              <FailureCard
                key={"turnId" in call ? `${call.turnId}-${call.position}` : call.position}
                call={call}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
