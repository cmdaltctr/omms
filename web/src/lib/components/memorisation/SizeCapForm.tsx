import { useRef, type KeyboardEvent } from "react";
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
/** The preset radios in order; Custom is last and has no value of its own. */
const PRESET_CHOICES = [...PRESETS, "custom"] as const;

const choiceClass = (on: boolean) =>
  cn(
    "min-h-9 rounded-[10px] border px-3 text-ui transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
    on
      ? "border-primary/40 bg-selection text-foreground hover:bg-selection active:bg-selection"
      : "border-input bg-card text-muted-foreground hover:bg-interactive-hover"
  );

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

type Radios = { current: (HTMLButtonElement | null)[] };

/**
 * The radio an arrow key moves to, or null for any other key. Focus counts from the radio the
 * key came from (Custom can hold focus without being checked), else from `checked`. In a right
 * to left row Left moves forward. The row wraps at both ends.
 */
function arrowTarget(event: KeyboardEvent<HTMLDivElement>, radios: Radios, checked: number) {
  const step = STEP[event.key];
  if (!step) return null;
  event.preventDefault();
  const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
  const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
  const from = radios.current.indexOf(event.target as HTMLButtonElement);
  const count = radios.current.length;
  const next = ((from < 0 ? checked : from) + (rtl && horizontal ? -step : step) + count) % count;
  radios.current[next]?.focus();
  return next;
}

/** The checked radio takes the tab stop; with none checked, the first does. */
const tabStop = (index: number, checked: number) => (index === Math.max(checked, 0) ? 0 : -1);

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
  const presetRadios: Radios = useRef([]);
  const unitRadios: Radios = useRef([]);
  const chosenAt = PRESET_CHOICES.indexOf(chosen);
  const unitAt = UNITS.indexOf(unit);
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
        onKeyDown={(event) => {
          const next = arrowTarget(event, presetRadios, chosenAt);
          // Custom has no value, so arrowing onto it moves focus only.
          const preset = next === null ? undefined : PRESETS[next];
          if (preset) onPreset(preset);
        }}
      >
        {PRESETS.map((preset, index) => (
          <Button
            key={preset}
            ref={(node) => {
              presetRadios.current[index] = node;
            }}
            type="button"
            variant="outline"
            role="radio"
            aria-checked={chosen === preset}
            tabIndex={tabStop(index, chosenAt)}
            disabled={busy}
            className={choiceClass(chosen === preset)}
            onClick={() => onPreset(preset)}
          >
            {t("memorisation-preset-option", {
              name: t(`memorisation-preset-${preset}`),
              size: presetSizeIn(presets[preset], unit),
            })}
          </Button>
        ))}
        {/* Custom has no value of its own: pressing it moves the user to the box. */}
        <Button
          ref={(node) => {
            presetRadios.current[PRESETS.length] = node;
          }}
          type="button"
          variant="outline"
          role="radio"
          aria-checked={chosen === "custom"}
          tabIndex={tabStop(PRESETS.length, chosenAt)}
          disabled={busy}
          className={choiceClass(chosen === "custom")}
          onClick={() => document.getElementById("memorisation-size")?.focus()}
        >
          {t("memorisation-preset-custom")}
        </Button>
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
          onKeyDown={(event) => {
            const next = arrowTarget(event, unitRadios, unitAt);
            const value = next === null ? undefined : UNITS[next];
            if (value) onUnit(value);
          }}
        >
          {UNITS.map((value, index) => (
            <Button
              key={value}
              ref={(node) => {
                unitRadios.current[index] = node;
              }}
              type="button"
              variant="outline"
              role="radio"
              aria-checked={unit === value}
              tabIndex={tabStop(index, unitAt)}
              disabled={busy}
              className={choiceClass(unit === value)}
              onClick={() => isSizeUnit(value) && onUnit(value)}
            >
              {t(`memorisation-unit-${value}`)}
            </Button>
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
