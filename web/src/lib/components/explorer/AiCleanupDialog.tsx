import { useEffect, useMemo, useRef, useState } from "react";
import { Loader } from "lucide-react";
import { toast } from "sonner";
import { aiCleanupApi } from "$lib/api";
import { useAiCleanupJob } from "@/hooks/useAiCleanupJob";
import { useAiCheckedIds } from "@/hooks/useAiCheckedIds";
import { dialogView, retrySelection, selectionAfterStop } from "./ai-cleanup-job-state";
import { AiCleanupReview } from "./AiCleanupReview";
import { AiCleanupSelect, type CleanupItem } from "./AiCleanupSelect";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import {
  allIds,
  cleanAllIds,
  lowFrequencyIds,
  sameCategoryIds,
  selectedFirst,
  withToggled,
  type Pick,
} from "$lib/cleanup-selection";
import { useI18n } from "$lib/i18n";
import type { UserProfile } from "$lib/types";

type Props = {
  open?: boolean;
  profile?: UserProfile | null;
  onOpenChange?: (open: boolean) => void;
  onApplied?: () => void;
  onMinimise?: () => void;
};

export function AiCleanupDialog(props: Props) {
  const { open = false, profile = null, onOpenChange, onApplied, onMinimise } = props;
  const { t } = useI18n();
  const cleanup = useAiCleanupJob(open);
  const checked = useAiCheckedIds(open, profile?.version);
  const [starting, setStarting] = useState(false);
  const [allItems, setAllItems] = useState<CleanupItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The order follows a shortcut's picks, not each tick, so rows do not jump while ticking.
  const [orderIds, setOrderIds] = useState<Set<string>>(new Set());
  // How many checked memories the last shortcut left out.
  const [skipped, setSkipped] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
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

  // Categories in name order; inside one, preferences, then patterns, then workflows.
  const groups = useMemo(() => {
    const map = new Map<string, CleanupItem[]>();
    for (const type of ["pref", "pat", "wf"] as const) {
      for (const it of allItems.filter((x) => x._type === type)) {
        const cat = it.category || "(none)";
        map.set(cat, [...(map.get(cat) ?? []), it]);
      }
    }
    const all = [...map.keys()].sort().map((key) => ({ key, items: map.get(key)! }));
    return selectedFirst(all, orderIds);
  }, [allItems, orderIds]);
  const diffSelectedCount = acceptedMerged.size + acceptedRemoved.size;

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
    // The dialog opens with nothing ticked; the user chooses a shortcut.
    pick({ ids: new Set(), skipped: 0 });
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

  /** A shortcut's selection: tick it, move it to the top and show the top. */
  function pick({ ids, skipped: left }: Pick) {
    setSelectedIds(ids);
    setOrderIds(ids);
    setSkipped(left);
    listRef.current?.scrollTo({ top: 0 });
  }

  const checkedIds = checked.ids as Set<string>;
  const shortcuts = {
    onSelectClean: () => pick(cleanAllIds(allItems, checkedIds)),
    onSelectLow: () => pick(lowFrequencyIds(allItems, checkedIds)),
    onSelectSameCat: () => pick(sameCategoryIds(allItems, checkedIds)),
    onSelectAll: () => pick(allIds(allItems)),
    onSelectNone: () => pick({ ids: new Set(), skipped: 0 }),
    skipped,
  };

  async function analyze(ids: string[]) {
    if (ids.length === 0) {
      toast.warning(t("toast-ai-cleanup-none-selected"));
      return;
    }
    setStarting(true);
    await cleanup.start(ids, profile?.version, t("toast-ai-cleanup-failed"));
    setStarting(false);
  }

  /** Stop, or Back from a result or a failure: back to the selection the job ran with. */
  function backToSelection() {
    pick({ ids: selectionAfterStop(job, selectedIds), skipped: 0 });
    void cleanup.discard();
    // The job may have marked memories when it finished.
    checked.reload();
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
      const { applied = 0, skipped: notApplied = 0 } = result.data ?? {};
      toast.success(
        notApplied > 0
          ? t("toast-ai-cleanup-skipped", { applied, skipped: notApplied })
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
        // Focus the dialog, not the first shortcut, so no tooltip opens with the dialog.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
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
          <AiCleanupSelect
            groups={groups}
            selectedIds={selectedIds}
            checkedIds={checkedIds}
            listRef={listRef}
            onToggle={(id, on) => setSelectedIds((prev) => withToggled(prev, id, on))}
            shortcuts={shortcuts}
            onAnalyze={() => analyze([...selectedIds])}
          />
        ) : view.phase === "review" && review ? (
          <AiCleanupReview
            review={review}
            notice={view.notice}
            acceptedMerged={acceptedMerged}
            acceptedRemoved={acceptedRemoved}
            onToggleMerged={(i, on) => setAcceptedMerged((prev) => withToggled(prev, i, on))}
            onToggleRemoved={(i, on) => setAcceptedRemoved((prev) => withToggled(prev, i, on))}
            onSelectAll={() => {
              setAcceptedMerged(new Set((review.changes.merged || []).map((_, i) => i)));
              setAcceptedRemoved(new Set((review.changes.removed || []).map((_, i) => i)));
            }}
            onDeselectAll={() => {
              setAcceptedMerged(new Set());
              setAcceptedRemoved(new Set());
            }}
            keptOpen={keptOpen}
            onKeptOpenChange={setKeptOpen}
          />
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
