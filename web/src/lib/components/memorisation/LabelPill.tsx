import { HuePill } from "$lib/components/skills/HuePill";
import { useI18n } from "$lib/i18n";

/** A label of a memorisation, in the colour its text always gets. Pressing it filters by it. */
export function LabelPill({
  label,
  active,
  onAdd,
}: {
  label: string;
  /** The label is already in the filter. */
  active: boolean;
  onAdd: (label: string) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t("memorisation-label-add", { label })}
      aria-pressed={active}
      className="max-w-full cursor-pointer rounded-[7px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      onClick={() => onAdd(label)}
    >
      <HuePill
        label={label}
        className={active ? "ring-2 ring-offset-1 ring-offset-background ring-border" : undefined}
      />
    </button>
  );
}
