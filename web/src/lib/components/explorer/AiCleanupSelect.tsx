import type { ComponentProps, KeyboardEvent, RefObject } from "react";
import { CheckCheck, Target } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { Tooltip } from "$lib/components/ui/tooltip";
import { useI18n } from "$lib/i18n";
import type { ProfileItem } from "$lib/types";
import { CleanupSelectShortcuts } from "./CleanupSelectShortcuts";

export type CleanupItem = ProfileItem & { _id: string; _type: "pref" | "pat" | "wf" };

type Props = {
  groups: Array<{ key: string; items: CleanupItem[] }>;
  selectedIds: Set<string>;
  /** Memories AI Cleanup already checked and kept. Their rows carry a "Checked" label. */
  checkedIds: ReadonlySet<string>;
  listRef: RefObject<HTMLDivElement | null>;
  onToggle: (id: string, checked: boolean) => void;
  shortcuts: ComponentProps<typeof CleanupSelectShortcuts>;
  onAnalyze: () => void;
};

/** The selection screen of the AI Cleanup dialog: shortcuts, memory rows and the count. */
export function AiCleanupSelect({
  groups,
  selectedIds,
  checkedIds,
  listRef,
  onToggle,
  shortcuts,
  onAnalyze,
}: Props) {
  const { t } = useI18n();

  return (
    // Tooltips stay inside this view's width. It does not clip, so a tooltip above the
    // shortcut row can show over the dialog header; the list below scrolls on its own.
    <div data-tooltip-bounds className="flex min-h-0 min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-subsection-title font-semibold">{t("label-ai-cleanup-select")}</h3>
        <CleanupSelectShortcuts {...shortcuts} />
      </div>
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden pe-1"
      >
        {groups.map(({ key: cat, items }) => (
          <div key={cat} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <bdi className="text-xs rounded-full bg-muted px-2 py-0.5">{cat}</bdi>
              <span className="text-xs text-muted-foreground">{items.length} items</span>
            </div>
            {items.map((it) => {
              const checked = selectedIds.has(it._id);
              return (
                <div
                  key={it._id}
                  className="flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/40"
                  role="checkbox"
                  aria-checked={checked}
                  tabIndex={0}
                  onClick={() => onToggle(it._id, !checked)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggle(it._id, !checked);
                    }
                  }}
                >
                  <span className="pointer-events-none inline-flex">
                    <Checkbox checked={checked} tabIndex={-1} />
                  </span>
                  <span className="text-[10px] font-medium text-muted-foreground w-4">
                    {it._type === "pref" ? "P" : it._type === "pat" ? "T" : "W"}
                  </span>
                  <span className="flex-1 min-w-0 truncate">
                    {(it.description || "").substring(0, 80)}
                  </span>
                  {checkedIds.has(it._id) ? <CheckedLabel /> : null}
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    <Target className="size-3" />
                    {it.frequency || 0}
                    {it.confidence != null ? ` | ${Math.round(it.confidence * 100)}%` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="rounded-md border border-status-success/30 bg-status-success/10 px-2 py-0.5 text-xs font-medium text-status-success">
          {t("label-ai-cleanup-selected", { count: selectedIds.size })}
        </span>
        <Button onClick={onAnalyze}>{t("label-ai-cleanup-analyze")}</Button>
      </div>
    </div>
  );
}

/** A word and an icon, so the state does not rely on colour. Focus shows the tooltip. */
export function CheckedLabel() {
  const { t } = useI18n();
  // Keys on the label must not tick the row it sits in.
  const keepKeys = (e: KeyboardEvent) => e.stopPropagation();
  return (
    <Tooltip content={t("label-ai-cleanup-checked-tip")} className="shrink-0">
      <span
        tabIndex={0}
        onKeyDown={keepKeys}
        className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
      >
        <CheckCheck className="size-3" aria-hidden="true" />
        {t("label-ai-cleanup-checked")}
      </span>
    </Tooltip>
  );
}
