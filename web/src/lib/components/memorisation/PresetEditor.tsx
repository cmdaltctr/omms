import { useState } from "react";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { useI18n } from "$lib/i18n";
import {
  DEFAULT_PRESETS,
  PRESETS,
  SIZE_RANGE,
  checkPresets,
  presetSizeIn,
  type Preset,
  type PresetProblem,
} from "$lib/memorisation-model";

type Drafts = Record<Preset, string>;

const draftsOf = (presets: Record<Preset, number>): Drafts => ({
  short: String(presets.short),
  medium: String(presets.medium),
  long: String(presets.long),
});

/**
 * Edits the three note length presets, in characters. The boxes open from the saved values.
 * Save checks the numbers first and names the broken rule; Reset presets only fills the
 * defaults, so nothing saves until Save.
 */
export function PresetEditor({
  presets,
  busy,
  onSave,
}: {
  presets: Record<Preset, number>;
  busy: boolean;
  /** Resolves true when the server accepted the values. */
  onSave: (values: Record<Preset, number>) => Promise<boolean>;
}) {
  const { t, language } = useI18n();
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [problem, setProblem] = useState<PresetProblem | null>(null);

  if (!drafts) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => {
          setProblem(null);
          setDrafts(draftsOf(presets));
        }}
      >
        {t("memorisation-preset-edit")}
      </Button>
    );
  }

  const name = (preset: Preset) => t(`memorisation-preset-${preset}`);
  const number = new Intl.NumberFormat(language);
  const message = problem
    ? problem.rule === "range"
      ? t("memorisation-preset-range", {
          name: name(problem.preset),
          min: number.format(SIZE_RANGE.characters.min),
          max: number.format(SIZE_RANGE.characters.max),
        })
      : problem.rule === "order"
        ? t("memorisation-preset-order", {
            lower: name(problem.lower),
            higher: name(problem.higher),
          })
        : t("memorisation-preset-token", {
            lower: name(problem.lower),
            higher: name(problem.higher),
            n: number.format(problem.tokens),
          })
    : null;

  async function save(current: Drafts) {
    const checked = checkPresets(current);
    if ("problem" in checked) return setProblem(checked.problem);
    setProblem(null);
    if (await onSave(checked.presets)) setDrafts(null);
  }

  return (
    <div className="space-y-3" role="group" aria-label={t("memorisation-preset-edit")}>
      <div className="grid gap-3 sm:grid-cols-3">
        {PRESETS.map((preset) => {
          const value = Number(drafts[preset].trim());
          const valid = /^\d+$/.test(drafts[preset].trim()) && Number.isSafeInteger(value);
          return (
            <div key={preset} className="min-w-0 space-y-1">
              <Label htmlFor={`memorisation-preset-${preset}`}>{name(preset)}</Label>
              <Input
                id={`memorisation-preset-${preset}`}
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={drafts[preset]}
                disabled={busy}
                onChange={(event) => {
                  setProblem(null);
                  setDrafts({ ...drafts, [preset]: event.target.value });
                }}
              />
              <p className="text-xs text-muted-foreground">
                {valid
                  ? t("memorisation-preset-tokens", { n: presetSizeIn(value, "tokens") })
                  : " "}
              </p>
            </div>
          );
        })}
      </div>
      {message ? (
        <p role="alert" className="text-sm text-destructive-label">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={busy} onClick={() => void save(drafts)}>
          {t("memorisation-preset-save")}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setDrafts(null)}>
          {t("memorisation-preset-cancel")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setProblem(null);
            setDrafts(draftsOf(DEFAULT_PRESETS));
          }}
        >
          {t("memorisation-preset-reset")}
        </Button>
      </div>
    </div>
  );
}
