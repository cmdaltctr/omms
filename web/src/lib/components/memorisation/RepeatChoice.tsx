import { useI18n } from "$lib/i18n";
import type { Repeat } from "$lib/memorisation-model";
import { cn } from "$lib/utils";

const CHOICES: { value: Repeat; title: string; detail: string }[] = [
  {
    value: "add",
    title: "memorisation-repeat-add",
    detail: "memorisation-repeat-add-detail",
  },
  {
    value: "replace",
    title: "memorisation-repeat-replace",
    detail: "memorisation-repeat-replace-detail",
  },
];

/** The `memorisationRepeat` choice: two options, each with its own short description. */
export function RepeatChoice({
  value,
  disabled,
  onChoose,
}: {
  value: Repeat;
  disabled: boolean;
  onChoose: (value: Repeat) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={t("memorisation-repeat-label")}
      className="grid gap-3 sm:grid-cols-2"
    >
      {CHOICES.map((choice) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={value === choice.value}
          disabled={disabled}
          className={cn(
            "min-w-0 space-y-1 rounded-[10px] border p-3 text-start transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
            value === choice.value
              ? "border-primary/40 bg-selection text-foreground"
              : "border-input bg-card text-foreground hover:bg-interactive-hover"
          )}
          onClick={() => {
            if (value !== choice.value) onChoose(choice.value);
          }}
        >
          <span className="block text-ui font-medium">{t(choice.title)}</span>
          <span className="block text-xs text-muted-foreground">{t(choice.detail)}</span>
        </button>
      ))}
    </div>
  );
}
