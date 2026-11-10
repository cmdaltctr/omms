import { X } from "lucide-react";
import { HuePill } from "$lib/components/skills/HuePill";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";

/** The labels the list is filtered by, each with an x to remove it, and Clear labels. */
export function LabelFilterBar({
  labels,
  onRemove,
  onClear,
}: {
  labels: readonly string[];
  onRemove: (label: string) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{t("memorisation-filter-active")}</span>
      {labels.map((label) => (
        <span key={label} className="inline-flex max-w-full items-center gap-0.5">
          <HuePill label={label} />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("memorisation-filter-remove", { label })}
            onClick={() => onRemove(label)}
          >
            <X aria-hidden="true" />
          </Button>
        </span>
      ))}
      <Button type="button" variant="outline" size="xs" onClick={onClear}>
        {t("memorisation-filter-clear")}
      </Button>
    </div>
  );
}
