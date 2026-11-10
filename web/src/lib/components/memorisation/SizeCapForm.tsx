import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { useI18n } from "$lib/i18n";
import { isSizeUnit, type SizeUnit } from "$lib/memorisation-model";
import { cn } from "$lib/utils";

const UNITS: SizeUnit[] = ["characters", "tokens"];

/** The size cap: a number box, a Characters or Tokens choice, and Save. They save as a pair. */
export function SizeCapForm({
  sizeText,
  unit,
  busy,
  changed,
  onSize,
  onUnit,
  onSave,
}: {
  sizeText: string;
  unit: SizeUnit;
  busy: boolean;
  /** The box or the unit differs from the saved values. */
  changed: boolean;
  onSize: (text: string) => void;
  onUnit: (unit: SizeUnit) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40 min-w-0 max-w-full space-y-1">
          <Label htmlFor="memorisation-size">{t("memorisation-size-label")}</Label>
          <Input
            id="memorisation-size"
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={sizeText}
            disabled={busy}
            aria-describedby="memorisation-size-note"
            onChange={(event) => onSize(event.target.value)}
          />
        </div>
        <div
          role="radiogroup"
          aria-label={t("memorisation-unit-label")}
          className="inline-flex gap-1.5"
        >
          {UNITS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={unit === value}
              disabled={busy}
              className={cn(
                "min-h-9 rounded-[10px] border px-3 text-ui transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
                unit === value
                  ? "border-primary/40 bg-selection text-foreground"
                  : "border-input bg-card text-muted-foreground hover:bg-interactive-hover"
              )}
              onClick={() => isSizeUnit(value) && onUnit(value)}
            >
              {t(`memorisation-unit-${value}`)}
            </button>
          ))}
        </div>
        <Button type="submit" disabled={busy || !changed}>
          {t("memorisation-size-save")}
        </Button>
      </div>
      <p id="memorisation-size-note" className="text-xs text-muted-foreground">
        {t("memorisation-size-note")}
      </p>
    </form>
  );
}
