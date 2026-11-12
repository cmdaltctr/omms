import { MemorisationRow } from "./MemorisationRow";
import { MemorisationSelectBar } from "./MemorisationSelectBar";
import { isSelectable, type Selection } from "@/hooks/useMemorisationSelection";
import { PagedList, usePagedList } from "$lib/components/paged-list";
import { useI18n } from "$lib/i18n";
import { MEMORISATION_SORTS, type Memorisation } from "$lib/memorisation-model";

/** Shown when the project has no memorisations: how to make the first one. */
export const MEMORISE_COMMAND = 'om-memory-system memory memorise "your note"';

/** The memorisations of the active and linked spaces, newest first, five to a page. */
export function MemorisationList({
  items,
  labels,
  onDelete,
  onLabel,
  selection,
  onDeleteSelected,
}: {
  items: Memorisation[];
  /** The labels the list is filtered by. A new set returns the list to page 1. */
  labels: readonly string[];
  onDelete: (item: Memorisation) => void;
  onLabel: (label: string) => void;
  selection: Selection;
  onDeleteSelected: () => void;
}) {
  const { t } = useI18n();
  const { view, pageItems } = usePagedList({
    storageKey: "omms-list-memorisations",
    items,
    sorts: MEMORISATION_SORTS,
    resetKey: labels.join(","),
  });
  if (items.length === 0) {
    return labels.length > 0 ? (
      <p role="status" className="text-sm text-muted-foreground">
        {t("memorisation-filter-empty")}
      </p>
    ) : (
      <div className="space-y-2 rounded-xl border border-border bg-card p-4">
        <p className="font-medium">{t("memorisation-empty-title")}</p>
        <p className="text-sm text-muted-foreground">{t("memorisation-empty-body")}</p>
        <pre
          dir="ltr"
          className="overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs"
        >
          {MEMORISE_COMMAND}
        </pre>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <MemorisationSelectBar
        on={selection.on}
        count={selection.ids.size}
        onStart={selection.start}
        onCancel={selection.cancel}
        onSelectAll={() => selection.addAll(pageItems.filter(isSelectable).map((item) => item.id))}
        onDelete={onDeleteSelected}
      />
      <PagedList view={view} totalLabel={t("memorisation-total", { count: view.total })}>
        <ul aria-label={t("memorisation-list-label")} className="space-y-3">
          {pageItems.map((item) => (
            <MemorisationRow
              key={item.id}
              item={item}
              onDelete={onDelete}
              onLabel={onLabel}
              activeLabels={labels}
              select={
                selection.on
                  ? {
                      checked: selection.ids.has(item.id),
                      onChange: (checked) => selection.toggle(item.id, checked),
                    }
                  : undefined
              }
            />
          ))}
        </ul>
      </PagedList>
    </div>
  );
}
