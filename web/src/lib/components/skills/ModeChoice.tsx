import { useState } from "react";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import type { SkillMode } from "$lib/skills-api";
import { cn } from "$lib/utils";
import { Callout } from "./Callout";

const MODES: SkillMode[] = ["manual", "automatic"];

type ViewProps = {
  mode: SkillMode;
  disabled: boolean;
  /** The Automatic warning is open and waits for a confirmation. */
  confirming: boolean;
  onSelect: (mode: SkillMode) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ModeChoiceView({
  mode,
  disabled,
  confirming,
  onSelect,
  onConfirm,
  onCancel,
}: ViewProps) {
  const s = useSettingsText();
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={s("Mode")} className="inline-flex gap-1.5">
        {MODES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={disabled}
            className={cn(
              "min-h-9 rounded-[10px] border px-3 text-ui transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
              mode === value
                ? "border-primary/40 bg-selection text-foreground"
                : "border-input bg-card text-muted-foreground hover:bg-interactive-hover"
            )}
            onClick={() => onSelect(value)}
          >
            {s(value === "manual" ? "Manual" : "Automatic")}
          </button>
        ))}
      </div>
      {confirming ? (
        <Callout tone="warning">
          <p className="font-medium">{s("Turn on Automatic mode for this skill?")}</p>
          <p>
            {s(
              "OMMS will change this SKILL.md file without asking. It drafts an improvement after 10 new uses and at least 24 hours, then applies it. Each change can be undone."
            )}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" size="sm" disabled={disabled} onClick={onConfirm}>
              {s("Turn on Automatic")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              {s("Cancel")}
            </Button>
          </div>
        </Callout>
      ) : null}
    </div>
  );
}

/**
 * Manual or Automatic. Automatic asks first: OMMS would change the file
 * without asking, so the choice waits for a confirmation.
 */
export function ModeChoice({
  mode,
  disabled,
  onChoose,
}: {
  mode: SkillMode;
  disabled: boolean;
  onChoose: (mode: SkillMode) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <ModeChoiceView
      {...{ mode, disabled, confirming }}
      onSelect={(value) => {
        if (value === mode) return;
        if (value === "automatic") setConfirming(true);
        else {
          setConfirming(false);
          onChoose(value);
        }
      }}
      onConfirm={() => {
        setConfirming(false);
        onChoose("automatic");
      }}
      onCancel={() => setConfirming(false)}
    />
  );
}
