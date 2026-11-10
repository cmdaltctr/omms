import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Trash2 } from "lucide-react";
import { LabelPill } from "./LabelPill";
import { HuePill } from "$lib/components/skills/HuePill";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { formatDate } from "$lib/format";
import { hostName } from "$lib/host-label";
import { useI18n } from "$lib/i18n";
import { memorisationTitle, type Memorisation } from "$lib/memorisation-model";

type Copy = "idle" | "done" | "failed";

/** Select mode of a row: whether its checkbox shows, whether it is ticked, and how to tick it. */
export type RowSelect = { checked: boolean; onChange: (checked: boolean) => void };

/**
 * One memorisation: its title, ID, host, labels and time, then Show full text, Copy ID and
 * Delete. The full text opens in place. A label is a button that adds it to the filter. A record
 * in a linked space is read-only, so Delete and its checkbox stay visible but off, with the
 * reason beside them.
 */
export function MemorisationRow({
  item,
  onDelete,
  onLabel,
  activeLabels = [],
  select,
}: {
  item: Memorisation;
  onDelete: (item: Memorisation) => void;
  onLabel: (label: string) => void;
  activeLabels?: readonly string[];
  /** Set in select mode only. */
  select?: RowSelect;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<Copy>("idle");
  const textId = `memorisation-text-${item.id}`;
  const hintId = `memorisation-linked-${item.id}`;

  async function copyId() {
    try {
      await navigator.clipboard.writeText(item.id);
      setCopy("done");
    } catch {
      // The browser refused the clipboard, for example on a plain HTTP host.
      setCopy("failed");
    }
    setTimeout(() => setCopy("idle"), 4000);
  }

  return (
    <li className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          {select ? (
            <Checkbox
              className="mt-1"
              checked={select.checked}
              disabled={Boolean(item.space)}
              aria-label={t("memorisation-select-row", { id: item.id })}
              aria-describedby={item.space ? hintId : undefined}
              onCheckedChange={(value) => select.onChange(value === true)}
            />
          ) : null}
          <h3
            className="line-clamp-2 min-w-0 break-words text-subsection-title font-semibold text-foreground"
            dir="auto"
          >
            {memorisationTitle(item.content)}
          </h3>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("memorisation-id-label")}{" "}
            <bdi className="font-mono" dir="ltr">
              {item.id}
            </bdi>
          </span>
          {item.createdAt ? (
            <span>{t("memorisation-saved-at", { date: formatDate(item.createdAt) })}</span>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {item.kind === "snapshot" || item.kind === "explicit" ? (
            <HuePill
              label={t(`memorisation-kind-${item.kind}`)}
              colourKey={`memorisation-${item.kind}`}
            />
          ) : null}
          {item.host ? <HuePill label={hostName(item.host)} colourKey={item.host} /> : null}
          {item.space ? (
            <HuePill
              label={t("memorisation-linked-in", { space: item.space })}
              colourKey="linked"
            />
          ) : null}
          {item.confidence !== undefined ? (
            <HuePill
              label={t("memorisation-confidence", { score: item.confidence })}
              colourKey="confidence"
            />
          ) : null}
          {(item.tags ?? []).map((tag) => (
            <LabelPill
              key={tag}
              label={tag}
              active={activeLabels.some((own) => own.toLowerCase() === tag.toLowerCase())}
              onAdd={onLabel}
            />
          ))}
        </div>
      </div>
      {open ? (
        <div id={textId} className="rounded-lg border border-border bg-muted p-3">
          <pre
            aria-label={t("memorisation-text-label", { id: item.id })}
            className="max-h-96 overflow-y-auto font-sans text-sm whitespace-pre-wrap [overflow-wrap:anywhere]"
            dir="auto"
          >
            {item.content}
          </pre>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={textId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {t(open ? "memorisation-close" : "memorisation-open")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void copyId()}>
          <Copy aria-hidden="true" />
          {t("memorisation-copy")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={Boolean(item.space)}
          aria-describedby={item.space ? hintId : undefined}
          onClick={() => onDelete(item)}
        >
          <Trash2 aria-hidden="true" />
          {t("memorisation-delete")}
        </Button>
      </div>
      {item.space ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {t("memorisation-delete-linked", { space: item.space })}
        </p>
      ) : null}
      {copy !== "idle" ? (
        <p role="status" className="text-sm">
          {copy === "done"
            ? t("memorisation-copied", { id: item.id })
            : t("memorisation-copy-failed")}
        </p>
      ) : null}
    </li>
  );
}
