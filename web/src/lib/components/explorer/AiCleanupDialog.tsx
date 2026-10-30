import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GitMerge,
  Loader,
  Target,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { aiCleanupApi } from "$lib/api";
import { useAiCleanupJob } from "@/hooks/useAiCleanupJob";
import { dialogView, retrySelection, selectionAfterStop } from "./ai-cleanup-job-state";
import { CleanupSelectShortcuts } from "./CleanupSelectShortcuts";
import { CleanupSteps } from "./CleanupSteps";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { sameCategoryIds, withToggled } from "$lib/cleanup-selection";
import { useI18n } from "$lib/i18n";
import { findDescById, findStepsById } from "$lib/profile-utils";
import type { ProfileItem, UserProfile } from "$lib/types";

type CleanupItem = ProfileItem & { _id: string; _type: "pref" | "pat" | "wf" };

type Props = {
  open?: boolean;
  profile?: UserProfile | null;
  onOpenChange?: (open: boolean) => void;
  onApplied?: () => void;
  onMinimise?: () => void;
};

function truncate(text: string, max: number) {
  return text.length > max ? text.substring(0, max) + "..." : text;
}

export function AiCleanupDialog(props: Props) {
  const { open = false, profile = null, onOpenChange, onApplied, onMinimise } = props;
  const { t } = useI18n();
  const cleanup = useAiCleanupJob(open);
  const [starting, setStarting] = useState(false);
  const [allItems, setAllItems] = useState<CleanupItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [acceptedMerged, setAcceptedMerged] = useState<Set<number>>(new Set());
  const [acceptedRemoved, setAcceptedRemoved] = useState<Set<number>>(new Set());
  const [keptOpen, setKeptOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const wasOpen = useRef(false);

  const job = cleanup.job;
  const jobView = dialogView(job, cleanup.startError);
  // A kept job may be stale until the first read after opening answers.
  const waiting = starting || (!!job && !cleanup.checked);
  const view = waiting ? { phase: "running" as const, done: 0, total: 0 } : jobView;
  const review = view.phase === "review" ? view.result : null;

  const cats = useMemo(() => {
    const map: Record<string, { pref: CleanupItem[]; pat: CleanupItem[]; wf: CleanupItem[] }> = {};
    for (const it of allItems) {
      const cat = it.category || "(none)";
      if (!map[cat]) map[cat] = { pref: [], pat: [], wf: [] };
      map[cat][it._type].push(it);
    }
    return map;
  }, [allItems]);

  const sortedCatKeys = useMemo(() => Object.keys(cats).sort(), [cats]);
  const selectedCount = selectedIds.size;
  const diffSelectedCount = acceptedMerged.size + acceptedRemoved.size;
  const diffTotalCount =
    (review?.changes.merged?.length || 0) + (review?.changes.removed?.length || 0);

  function initSelect() {
    const pd = profile?.profileData;
    if (!pd) {
      toast.error("No profile data loaded");
      handleOpenChange(false);
      return;
    }

    const prefs = (pd.preferences || []).map((p, i) => ({
      ...p,
      _id: `pref_${i}`,
      _type: "pref" as const,
    }));
    const pats = (pd.patterns || []).map((p, i) => ({
      ...p,
      _id: `pat_${i}`,
      _type: "pat" as const,
    }));
    const wfs = (pd.workflows || []).map((w, i) => ({
      ...w,
      _id: `wf_${i}`,
      _type: "wf" as const,
    }));
    const items = [...prefs, ...pats, ...wfs];
    setAllItems(items);
    setSelectedIds(new Set(items.filter((it) => (it.frequency || 0) <= 3).map((it) => it._id)));
    setKeptOpen(false);
  }

  useEffect(() => {
    if (open && !wasOpen.current) {
      initSelect();
    } else if (!open && wasOpen.current) {
      setApplying(false);
    }
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-init on dialog open edge
  }, [open]);

  // A finished job opens its review with every change ticked.
  const doneJobId = job?.status.state === "done" ? job.id : null;
  useEffect(() => {
    if (job?.status.state !== "done") return;
    const { changes } = job.status.result;
    setAcceptedMerged(new Set((changes.merged || []).map((_, i) => i)));
    setAcceptedRemoved(new Set((changes.removed || []).map((_, i) => i)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new job finishes
  }, [doneJobId]);

  function handleOpenChange(next: boolean) {
    onOpenChange?.(next);
  }

  function toggleId(id: string, checked: boolean) {
    setSelectedIds((prev) => withToggled(prev, id, checked));
  }

  function selectAll() {
    setSelectedIds(new Set(allItems.map((it) => it._id)));
  }

  function selectNone() {
    setSelectedIds(new Set());
  }

  function selectLow() {
    setSelectedIds(new Set(allItems.filter((it) => (it.frequency || 0) <= 3).map((it) => it._id)));
  }

  function selectSameCat() {
    setSelectedIds(sameCategoryIds(allItems));
  }

  async function analyze(ids: string[]) {
    if (ids.length === 0) {
      toast.warning("No items selected");
      return;
    }
    setStarting(true);
    await cleanup.start(ids, profile?.version, t("toast-ai-cleanup-failed"));
    setStarting(false);
  }

  /** Stop, or Back from a result or a failure: back to the selection the job ran with. */
  function backToSelection() {
    setSelectedIds(selectionAfterStop(job, selectedIds));
    void cleanup.discard();
  }

  function typeLabel(id: string) {
    if (!id.includes("_")) return "?";
    const prefix = id.split("_")[0];
    if (prefix === "pref") return t("profile-type-pref") || "Pref";
    if (prefix === "pat") return t("profile-type-pat") || "Pat";
    if (prefix === "wf") return t("profile-type-wf") || "Wf";
    return "?";
  }

  function toggleMerged(i: number, checked: boolean) {
    setAcceptedMerged((prev) => withToggled(prev, i, checked));
  }

  function toggleRemoved(i: number, checked: boolean) {
    setAcceptedRemoved((prev) => withToggled(prev, i, checked));
  }

  function selectAllDiff() {
    setAcceptedMerged(new Set((review?.changes.merged || []).map((_, i) => i)));
    setAcceptedRemoved(new Set((review?.changes.removed || []).map((_, i) => i)));
  }

  function deselectAllDiff() {
    setAcceptedMerged(new Set());
    setAcceptedRemoved(new Set());
  }

  async function apply() {
    if (!review || diffSelectedCount === 0) return;
    setApplying(true);
    const acceptedMergedIds = [...acceptedMerged]
      .map((mi) => review.changes.merged?.[mi]?.ids)
      .filter((ids): ids is string[] => !!ids);
    const acceptedRemovedIds = [...acceptedRemoved]
      .map((ri) => review.changes.removed?.[ri]?.id)
      .filter((id): id is string => !!id);

    const result = await aiCleanupApi.apply(acceptedMergedIds, acceptedRemovedIds);
    setApplying(false);

    if (result.success) {
      const { applied = 0, skipped = 0 } = result.data ?? {};
      toast.success(
        skipped > 0
          ? t("toast-ai-cleanup-skipped", { applied, skipped })
          : t("toast-ai-cleanup-success")
      );
      cleanup.clear();
      handleOpenChange(false);
      onApplied?.();
    } else {
      toast.error(result.error || t("toast-cleanup-apply-failed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="grid! sm:max-w-2xl max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden gap-4"
        onMinimise={view.phase === "running" && !waiting ? onMinimise : undefined}
      >
        <DialogHeader className="pe-20">
          <DialogTitle>{t("label-ai-cleanup-title")}</DialogTitle>
        </DialogHeader>

        {view.phase === "running" ? (
          <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
            <Loader className="size-6 animate-spin" />
            <span className="text-sm">{t("label-ai-cleanup-loading")}</span>
            {view.total > 0 ? (
              <span className="text-sm font-medium text-foreground" aria-live="polite">
                {t("label-ai-cleanup-progress", { done: view.done, total: view.total })}
              </span>
            ) : null}
            <span className="text-xs">{t("label-ai-cleanup-running-hint")}</span>
          </div>
        ) : view.phase === "failed" ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center" role="alert">
            <span className="text-sm font-medium text-destructive">
              {t("toast-ai-cleanup-failed")}
            </span>
            <span className="text-sm text-muted-foreground break-words">{view.error}</span>
          </div>
        ) : view.phase === "select" ? (
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-subsection-title font-semibold">
                {t("label-ai-cleanup-select")}
              </h3>
              <CleanupSelectShortcuts
                onSelectAll={selectAll}
                onSelectNone={selectNone}
                onSelectLow={selectLow}
                onSelectSameCat={selectSameCat}
              />
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {sortedCatKeys.map((cat) => {
                const items = [...cats[cat].pref, ...cats[cat].pat, ...cats[cat].wf];
                return (
                  <div key={cat} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs rounded-full bg-muted px-2 py-0.5">{cat}</span>
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
                          onClick={() => toggleId(it._id, !checked)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleId(it._id, !checked);
                            }
                          }}
                        >
                          <span className="pointer-events-none inline-flex">
                            <Checkbox checked={checked} tabIndex={-1} />
                          </span>
                          <span className="text-[10px] font-medium text-muted-foreground w-4">
                            {it._type === "pref" ? "P" : it._type === "pat" ? "T" : "W"}
                          </span>
                          <span className="flex-1 truncate">
                            {(it.description || "").substring(0, 80)}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                            <Target className="size-3" />
                            {it.frequency || 0}
                            {it.confidence != null ? ` | ${Math.round(it.confidence * 100)}%` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="rounded-md border border-status-success/30 bg-status-success/10 px-2 py-0.5 text-xs font-medium text-status-success">
                {t("label-ai-cleanup-selected", { count: selectedCount })}
              </span>
              <Button onClick={() => analyze([...selectedIds])}>
                {t("label-ai-cleanup-analyze")}
              </Button>
            </div>
          </div>
        ) : view.phase === "review" && review ? (
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            {view.notice ? (
              <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                {t("label-ai-cleanup-failed-batches", view.notice)}
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
                <Button variant="link" size="xs" onClick={selectAllDiff}>
                  {t("label-ai-cleanup-select-all")}
                </Button>
                <Button variant="link" size="xs" onClick={deselectAllDiff}>
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
                          onClick={() => toggleMerged(mi, !mergeChecked)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleMerged(mi, !mergeChecked);
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
                          onClick={() => toggleRemoved(ri, !removeChecked)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleRemoved(ri, !removeChecked);
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
                    onClick={() => setKeptOpen((v) => !v)}
                  >
                    {t("label-ai-cleanup-kept")}
                    <span className="text-muted-foreground">
                      ({review.changes.kept?.length || 0})
                    </span>
                    {keptOpen ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
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
        ) : null}

        <DialogFooter>
          <Button variant="secondary" onClick={() => handleOpenChange(false)}>
            {t("btn-cancel")}
          </Button>
          {view.phase === "running" && !waiting ? (
            <Button variant="outline" onClick={backToSelection}>
              {t("btn-ai-cleanup-stop")}
            </Button>
          ) : null}
          {view.phase === "failed" || view.phase === "review" ? (
            <Button variant="outline" onClick={backToSelection}>
              {t("btn-ai-cleanup-back")}
            </Button>
          ) : null}
          {view.phase === "failed" ? (
            <Button onClick={() => analyze(retrySelection(job, selectedIds))}>
              {t("btn-ai-cleanup-retry")}
            </Button>
          ) : null}
          {view.phase === "review" ? (
            <Button disabled={diffSelectedCount === 0 || applying} onClick={apply}>
              {diffSelectedCount > 0
                ? `${t("label-ai-cleanup-apply")} (${diffSelectedCount})`
                : t("label-ai-cleanup-apply") || "Apply"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
