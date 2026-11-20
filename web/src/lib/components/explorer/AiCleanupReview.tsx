import { ChevronDown, ChevronRight, ChevronUp, GitMerge, Trash2 } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { useI18n } from "$lib/i18n";
import { findDescById, findStepsById } from "$lib/profile-utils";
import type { AiCleanupResult } from "./ai-cleanup-job-state";
import { CleanupSteps } from "./CleanupSteps";

type Props = {
  review: AiCleanupResult;
  notice: { batches: number; items: number } | null;
  acceptedMerged: Set<number>;
  acceptedRemoved: Set<number>;
  onToggleMerged: (index: number, checked: boolean) => void;
  onToggleRemoved: (index: number, checked: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  keptOpen: boolean;
  onKeptOpenChange: (open: boolean) => void;
};

function truncate(text: string, max: number) {
  return text.length > max ? text.substring(0, max) + "..." : text;
}

/** The review screen of the AI Cleanup dialog: merges, removals and the kept memories. */
export function AiCleanupReview({
  review,
  notice,
  acceptedMerged,
  acceptedRemoved,
  onToggleMerged,
  onToggleRemoved,
  onSelectAll,
  onDeselectAll,
  keptOpen,
  onKeptOpenChange,
}: Props) {
  const { t } = useI18n();
  const diffSelectedCount = acceptedMerged.size + acceptedRemoved.size;
  const diffTotalCount =
    (review.changes.merged?.length || 0) + (review.changes.removed?.length || 0);

  function typeLabel(id: string) {
    if (!id.includes("_")) return "?";
    const prefix = id.split("_")[0];
    if (prefix === "pref") return t("profile-type-pref") || "Pref";
    if (prefix === "pat") return t("profile-type-pat") || "Pat";
    if (prefix === "wf") return t("profile-type-wf") || "Wf";
    return "?";
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
      {notice ? (
        <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          {t("label-ai-cleanup-failed-batches", notice)}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t("label-ai-cleanup-changes-selected", {
            selected: diffSelectedCount,
            total: diffTotalCount,
          })}
        </span>
        <div className="flex gap-2">
          <Button variant="link" size="xs" onClick={onSelectAll}>
            {t("label-ai-cleanup-select-all")}
          </Button>
          <Button variant="link" size="xs" onClick={onDeselectAll}>
            {t("label-ai-cleanup-deselect-all")}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {(review.changes.merged || []).length > 0 ? (
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-subsection-title font-semibold">
              <GitMerge className="size-3.5" />
              {t("label-ai-cleanup-merged-header", {
                count: review.changes.merged?.length || 0,
              })}
            </h3>
            {(review.changes.merged || []).map((m, mi) => {
              const mergedFrom = m.ids.slice(1);
              const mainDesc = m.result || "";
              const mergeChecked = acceptedMerged.has(mi);
              return (
                <div key={mi} className="rounded-xl border border-border p-3 space-y-2">
                  <div
                    className="flex items-center gap-2 text-sm cursor-pointer"
                    role="checkbox"
                    aria-checked={mergeChecked}
                    tabIndex={0}
                    onClick={() => onToggleMerged(mi, !mergeChecked)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggleMerged(mi, !mergeChecked);
                      }
                    }}
                  >
                    <span className="pointer-events-none inline-flex">
                      <Checkbox checked={mergeChecked} tabIndex={-1} />
                    </span>
                    <span>{t("label-ai-cleanup-merge-check")}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] items-start text-sm">
                    <div className="space-y-1.5">
                      {mergedFrom.map((id) => {
                        const desc = findDescById(id, review.old);
                        if (!desc) return null;
                        return (
                          <div key={id} className="rounded-lg bg-muted/50 p-2 space-y-1">
                            <div>
                              <span className="text-[10px] rounded bg-muted px-1.5 py-0.5">
                                {typeLabel(id)}
                              </span>{" "}
                              {truncate(desc, 80)}
                            </div>
                            <CleanupSteps steps={findStepsById(id, review.old)} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-muted-foreground self-center grid place-items-center">
                      <ChevronRight className="size-4" />
                    </div>
                    <div className="rounded-lg bg-primary/10 p-2 space-y-1">
                      <div>{truncate(mainDesc, 120)}</div>
                      <CleanupSteps steps={findStepsById(m.ids[0], review.old)} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {(review.changes.removed || []).length > 0 ? (
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-subsection-title font-semibold">
              <Trash2 className="size-3.5" />
              {t("label-ai-cleanup-removed-header", {
                count: review.changes.removed?.length || 0,
              })}
            </h3>
            {(review.changes.removed || []).map((r, ri) => {
              const desc = findDescById(r.id, review.old);
              const removeChecked = acceptedRemoved.has(ri);
              return (
                <div key={ri} className="rounded-xl border border-border p-3 space-y-2">
                  <div
                    className="flex items-center gap-2 text-sm cursor-pointer"
                    role="checkbox"
                    aria-checked={removeChecked}
                    tabIndex={0}
                    onClick={() => onToggleRemoved(ri, !removeChecked)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggleRemoved(ri, !removeChecked);
                      }
                    }}
                  >
                    <span className="pointer-events-none inline-flex">
                      <Checkbox checked={removeChecked} tabIndex={-1} />
                    </span>
                    <span>{t("label-ai-cleanup-remove-check")}</span>
                  </div>
                  <div className="text-sm">{desc || r.id}</div>
                  <CleanupSteps steps={findStepsById(r.id, review.old)} />
                  <div className="text-xs text-muted-foreground">{r.reason}</div>
                </div>
              );
            })}
          </div>
        ) : null}

        {(review.changes.kept || []).length > 0 ? (
          <div className="space-y-2">
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm font-medium"
              onClick={() => onKeptOpenChange(!keptOpen)}
            >
              {t("label-ai-cleanup-kept")}
              <span className="text-muted-foreground">({review.changes.kept?.length || 0})</span>
              {keptOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {keptOpen ? (
              <div className="space-y-1">
                {(review.changes.kept || []).map((k, ki) => (
                  <div
                    key={ki}
                    className="text-xs text-muted-foreground rounded bg-muted/40 px-2 py-1"
                  >
                    {k}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
