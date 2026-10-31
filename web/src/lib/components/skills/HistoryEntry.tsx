import { useId } from "react";
import { Loader, Undo2 } from "lucide-react";
import { keywordHue } from "$lib/components/explorer/KeywordBadge";
import { Button } from "$lib/components/ui/button";
import { formatDate } from "$lib/format";
import { useSettingsText } from "$lib/i18n/settings";
import type { HistoryEntry } from "$lib/skills-api";
import { fill } from "$lib/skills-model";
import { Callout } from "./Callout";
import { HuePill } from "./HuePill";

export type EntryProps = {
  entry: HistoryEntry;
  /** The revert confirmation is open on this entry. */
  confirming: boolean;
  /** A revert of this entry is running. */
  working: boolean;
  /** Another revert runs, so this entry's button waits. */
  locked: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const kindLabel = (entry: HistoryEntry) =>
  entry.kind === "applied" && entry.appliedBy === "automatic"
    ? "applied automatically"
    : entry.kind;

/** One point on the History timeline: what happened, when, and how many lines it changed. */
export function HistoryEntryItem({
  entry,
  confirming,
  working,
  locked,
  onAsk,
  onConfirm,
  onCancel,
}: EntryProps) {
  const s = useSettingsText();
  const hintId = useId();
  const label = kindLabel(entry);
  const changed = entry.added > 0 || entry.removed > 0;
  return (
    <li className="relative min-w-0 space-y-1.5">
      <span
        aria-hidden="true"
        className="absolute -start-[21.5px] top-1.5 size-2.5 rounded-full border-2 border-background"
        style={{ backgroundColor: `oklch(0.66 0.14 ${keywordHue(label)})` }}
      />
      <p className="flex flex-wrap items-center gap-2">
        <HuePill label={s(label)} colourKey={label} />
        <time dateTime={new Date(entry.at).toISOString()} className="text-xs text-muted-foreground">
          {formatDate(entry.at)}
        </time>
        {changed ? (
          <span
            className="font-mono text-xs tabular-nums"
            dir="ltr"
            aria-label={fill(s("{added} lines added, {removed} lines removed"), {
              added: entry.added,
              removed: entry.removed,
            })}
          >
            <span className="text-status-success">+{entry.added}</span>{" "}
            <span className="text-destructive-label">−{entry.removed}</span>
          </span>
        ) : null}
      </p>
      {entry.summary ? (
        <p className="break-words text-sm" dir="auto">
          {entry.summary}
        </p>
      ) : null}
      {entry.kind === "applied" ? (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!entry.canUndo || locked || confirming}
            aria-describedby={entry.canUndo ? undefined : hintId}
            onClick={onAsk}
          >
            <Undo2 aria-hidden="true" />
            {s("Revert to before this change")}
          </Button>
          {entry.canUndo ? null : (
            <span id={hintId} className="text-xs text-muted-foreground">
              {s("Revert the newer change first.")}
            </span>
          )}
          {working ? (
            <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader className="size-4 animate-spin" aria-hidden="true" />
              {s("Reverting…")}
            </span>
          ) : null}
        </div>
      ) : null}
      {confirming ? (
        <Callout tone="warning">
          <p className="font-medium">{s("Revert this change?")}</p>
          <p>{s("OMMS restores SKILL.md as it was before this change.")}</p>
          {entry.laterAppliedCount > 0 ? (
            <p className="font-medium">
              {fill(
                s(
                  entry.laterAppliedCount === 1
                    ? "Reverting this also removes {count} later change."
                    : "Reverting this also removes {count} later changes."
                ),
                { count: entry.laterAppliedCount }
              )}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" size="sm" disabled={working || locked} onClick={onConfirm}>
              {s("Revert")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              {s("Cancel")}
            </Button>
          </div>
        </Callout>
      ) : null}
    </li>
  );
}
