import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { keywordHue } from "$lib/components/explorer/KeywordBadge";
import { useSettingsText } from "$lib/i18n/settings";
import { countText, fill } from "$lib/skills-model";
import { MODIFIED_FILTERS, type ModifiedFilter } from "$lib/skills-modified";
import { cn } from "$lib/utils";

const LABEL: Record<ModifiedFilter, string> = {
  all: "All ({count})",
  "not-modified": "Not modified ({count})",
  modified: "Modified ({count})",
  suggested: "Suggested ({count})",
};
/**
 * Each choice keeps its colour, so the meaning stays when it is not chosen:
 * green for modified, blue for not modified, neutral for all. The theme sets
 * the colours. The chosen button gets a stronger fill and border.
 */
const TONE: Record<ModifiedFilter, { idle: string; chosen: string }> = {
  all: {
    idle: "border-input bg-card text-muted-foreground hover:bg-interactive-hover",
    chosen: "border-primary/40 bg-selection text-foreground",
  },
  "not-modified": {
    idle: "border-status-info/35 bg-status-info/5 text-status-info hover:bg-status-info/15",
    chosen: "border-status-info/70 bg-status-info/20 text-status-info",
  },
  modified: {
    idle: "border-status-success/35 bg-status-success/5 text-status-success hover:bg-status-success/15",
    chosen: "border-status-success/70 bg-status-success/20 text-status-success",
  },
  suggested: {
    idle: "[color:oklch(0.42_0.13_var(--keyword-hue))] dark:[color:oklch(0.8_0.13_var(--keyword-hue))] hover:brightness-110",
    chosen:
      "[color:oklch(0.42_0.13_var(--keyword-hue))] dark:[color:oklch(0.8_0.13_var(--keyword-hue))]",
  },
};
/** Suggested takes the hue of the Suggested pill on the cards, so the two read as one. */
function suggestedStyle(chosen: boolean): CSSProperties {
  const hue = keywordHue("Suggested");
  return {
    backgroundColor: `oklch(0.72 0.14 ${hue} / ${chosen ? 0.3 : 0.1})`,
    borderColor: `oklch(0.72 0.14 ${hue} / ${chosen ? 0.8 : 0.4})`,
    ["--keyword-hue" as string]: String(hue),
  };
}
const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * All, Not modified or Modified as a radio group with live counts. The chosen
 * button is the one tab stop; arrow keys move the choice, as in the Activity range.
 */
export function ModifiedFilterControl({
  value,
  counts,
  onChange,
}: {
  value: ModifiedFilter;
  counts: Record<ModifiedFilter, number>;
  onChange: (value: ModifiedFilter) => void;
}) {
  const s = useSettingsText();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (index: number) => {
    buttons.current[index]?.focus();
    onChange(MODIFIED_FILTERS[index]!);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP[event.key];
    if (!step) return;
    event.preventDefault();
    // In Arabic the row runs right to left, so Left moves forward.
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const move = rtl && horizontal ? -step : step;
    const at = MODIFIED_FILTERS.indexOf(value);
    choose((at + move + MODIFIED_FILTERS.length) % MODIFIED_FILTERS.length);
  };
  return (
    <div
      role="radiogroup"
      aria-label={s("Show skills by modification")}
      className="inline-flex flex-wrap gap-1.5"
      onKeyDown={onKeyDown}
    >
      {MODIFIED_FILTERS.map((filter, index) => (
        <button
          key={filter}
          ref={(node) => {
            buttons.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={value === filter}
          tabIndex={value === filter ? 0 : -1}
          className={cn(
            "min-h-9 rounded-[10px] border px-3 text-ui transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring",
            value === filter ? TONE[filter].chosen : TONE[filter].idle
          )}
          style={filter === "suggested" ? suggestedStyle(value === filter) : undefined}
          onClick={() => choose(index)}
        >
          {fill(s(LABEL[filter]), { count: countText(counts[filter]) })}
        </button>
      ))}
    </div>
  );
}
