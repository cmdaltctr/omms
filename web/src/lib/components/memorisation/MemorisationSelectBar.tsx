import { CheckSquare, Trash2 } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";

/**
 * The select controls above the list. Off, it shows Select. On, it shows Select all (the
 * selectable records of this page), the count, Delete selected and Cancel.
 */
export function MemorisationSelectBar({
  on,
  count,
  onStart,
  onCancel,
  onSelectAll,
  onDelete,
}: {
  on: boolean;
  count: number;
  onStart: () => void;
  onCancel: () => void;
  onSelectAll: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  if (!on) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="outline" size="xs" onClick={onStart}>
          <CheckSquare aria-hidden="true" />
          {t("memorisation-select")}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button type="button" variant="secondary" size="xs" onClick={onSelectAll}>
        {t("memorisation-select-all")}
      </Button>
      <span className="text-xs text-muted-foreground" aria-live="polite">
        {t("memorisation-selected", { count })}
      </span>
      <Button
        type="button"
        variant="destructive"
        size="xs"
        disabled={count === 0}
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" />
        {t("memorisation-delete-selected")}
      </Button>
      <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
        {t("memorisation-select-cancel")}
      </Button>
    </div>
  );
}
