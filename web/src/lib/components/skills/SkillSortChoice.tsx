import { useSettingsText } from "$lib/i18n/settings";
import type { SkillOrder } from "$lib/skills-api";
import { cn } from "$lib/utils";

const ORDERS: SkillOrder[] = ["uses", "attention"];

/** Most used or Needs attention, as a small radio group beside the filter. */
export function SkillSortChoice({
  order,
  onChange,
}: {
  order: SkillOrder;
  onChange: (order: SkillOrder) => void;
}) {
  const s = useSettingsText();
  return (
    <div role="radiogroup" aria-label={s("Sort skills")} className="inline-flex gap-1.5">
      {ORDERS.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={order === value}
          className={cn(
            "min-h-9 rounded-[10px] border px-3 text-ui transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring",
            order === value
              ? "border-primary/40 bg-selection text-foreground"
              : "border-input bg-card text-muted-foreground hover:bg-interactive-hover"
          )}
          onClick={() => onChange(value)}
        >
          {s(value === "uses" ? "Most used" : "Needs attention")}
        </button>
      ))}
    </div>
  );
}
