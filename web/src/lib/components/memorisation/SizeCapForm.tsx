import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { useI18n } from "$lib/i18n";
import {
  PRESETS,
  isSizeUnit,
  presetSizeIn,
  selectedPreset,
  type Preset,
  type SizeUnit,
} from "$lib/memorisation-model";
import { cn } from "$lib/utils";

const UNITS: SizeUnit[] = ["characters", "tokens"];

const choiceClass = (on: boolean) =>
  cn(
    "min-h-9 rounded-[10px] border px-3 text-ui transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
    on
      ? "border-primary/40 bg-selection text-foreground"
      : "border-input bg-card text-muted-foreground hover:bg-interactive-hover"
  );

/**
 * The size cap: a Short, Medium, Long or Custom choice, a number box, a Characters or Tokens
 * choice, and Save. The cap and unit save as a pair. The preset choice is worked out from the
 * box, so typing a number moves it to the matching preset or to Custom.
 */
export function SizeCapForm({
  sizeText,
  unit,
  presets,
  busy,
  changed,
  onSize,
  onPreset,
  onUnit,
  onSave,
}: {
  sizeText: string;
  unit: SizeUnit;
  /** Characters per preset. */
  presets: Record<Preset, number>;
  busy: boolean;
  /** The box or the unit differs from the saved values. */
  changed: boolean;
  onSize: (text: string) => void;
  onPreset: (preset: Preset) => void;
  onUnit: (unit: SizeUnit) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const chosen = selectedPreset(sizeText, unit, presets);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div
        role="radiogroup"
        aria-label={t("memorisation-preset-label")}
        className="flex flex-wrap gap-1.5"
      >
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            role="radio"
            aria-checked={chosen === preset}
            disabled={busy}
            className={choiceClass(chosen === preset)}
            onClick={() => onPreset(preset)}
          >
            {t("memorisation-preset-option", {
              name: t(`memorisation-preset-${preset}`),
              size: presetSizeIn(presets[preset], unit),
            })}
          </button>
        ))}
        {/* Custom has no value of its own: pressing it moves the user to the box. */}
        <button
          type="button"
          role="radio"
          aria-checked={chosen === "custom"}
          disabled={busy}
          className={choiceClass(chosen === "custom")}
          onClick={() => document.getElementById("memorisation-size")?.focus()}
        >
          {t("memorisation-preset-custom")}
        </button>
      </div>
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
              className={choiceClass(unit === value)}
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
