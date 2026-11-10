import { useEffect, useState } from "react";
import { BulkDeleteDialog } from "./BulkDeleteDialog";
import { BulkDeleteResult } from "./BulkDeleteResult";
import { DeleteMemorisationDialog } from "./DeleteMemorisationDialog";
import { LabelFilterBar } from "./LabelFilterBar";
import { MemorisationList } from "./MemorisationList";
import { MemorisationSearch } from "./MemorisationSearch";
import { MemorisationSettings } from "./MemorisationSettings";
import { useMemorisationLabels } from "@/hooks/useMemorisationLabels";
import { useMemorisationSelection } from "@/hooks/useMemorisationSelection";
import { useMemorisations } from "@/hooks/useMemorisations";
import { Callout } from "$lib/components/skills/Callout";
import { useI18n } from "$lib/i18n";
import type { BulkDeleteResult as BulkResult, Memorisation } from "$lib/memorisation-model";

/**
 * The Memorisation page: a recall search, the saved memorisations of this project in the active
 * and linked spaces, and the two settings. A label filter and select mode narrow and clear the
 * list. Delete asks first and says when it is done.
 */
export function MemorisationView() {
  const { t } = useI18n();
  const { labels, addLabel, removeLabel, clearLabels } = useMemorisationLabels();
  const memorisations = useMemorisations(labels);
  const { items, loadFailed, load } = memorisations;
  const selection = useMemorisationSelection(items);
  const [deleting, setDeleting] = useState<Memorisation | null>(null);
  const [deleted, setDeleted] = useState("");
  const [askingBulk, setAskingBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmDelete(item: Memorisation): Promise<boolean> {
    const result = await memorisations.remove(item.id);
    if (result.success) {
      setDeleted(item.id);
      setBulkResult(null);
    }
    return result.success;
  }

  async function confirmBulk(): Promise<boolean> {
    const result = await memorisations.removeMany([...selection.ids]);
    if (!result) return false;
    setBulkResult(result);
    setDeleted("");
    selection.cancel();
    void load();
    return true;
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">{t("memorisation-intro")}</p>
      <MemorisationSearch
        recall={memorisations.recall}
        onSearch={(text) => void memorisations.search(text)}
        onClear={memorisations.clearSearch}
        onDelete={setDeleting}
        onLabel={addLabel}
        activeLabels={labels}
      />
      <section aria-labelledby="memorisation-list" className="space-y-3">
        <h2
          id="memorisation-list"
          className="text-section-title font-semibold text-muted-foreground"
        >
          {t("memorisation-list-title")}
        </h2>
        {deleted ? (
          <p role="status" className="text-sm">
            {t("memorisation-deleted", { id: deleted })}
          </p>
        ) : null}
        {bulkResult ? <BulkDeleteResult result={bulkResult} /> : null}
        <LabelFilterBar labels={labels} onRemove={removeLabel} onClear={clearLabels} />
        {loadFailed ? <Callout tone="danger">{t("memorisation-load-failed")}</Callout> : null}
        {items === null && !loadFailed ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("memorisation-loading")}
          </p>
        ) : null}
        {items !== null ? (
          <MemorisationList
            items={items}
            labels={labels}
            onDelete={setDeleting}
            onLabel={addLabel}
            selection={selection}
            onDeleteSelected={() => setAskingBulk(true)}
          />
        ) : null}
      </section>
      <MemorisationSettings />
      {deleting ? (
        <DeleteMemorisationDialog
          item={deleting}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      ) : null}
      {askingBulk ? (
        <BulkDeleteDialog
          count={selection.ids.size}
          onConfirm={confirmBulk}
          onClose={() => setAskingBulk(false)}
        />
      ) : null}
    </div>
  );
}
