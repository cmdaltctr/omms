import { useRef, type KeyboardEvent } from "react";
import { Loader } from "lucide-react";
import { Select } from "$lib/components/ui/select";
import { dateContext } from "$lib/format";
import { useSettingsText } from "$lib/i18n/settings";
import {
  pickerOptions,
  pickerValue,
  rangeForBucket,
  rangeFromPicker,
  type ActivityRange,
} from "$lib/skill-activity";
import type { ActivityBucket, SkillActivity } from "$lib/skills-api";
import { cn } from "$lib/utils";

const BUCKETS: readonly ActivityBucket[] = ["day", "month", "year"];
const BUCKET_LABEL: Record<ActivityBucket, string> = {
  day: "Days",
  month: "Months",
  year: "Years",
};
const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Days, Months or Years as a radio group, then one picker: the last 30 days
 * or a month under Days, a year under Months, nothing under Years. The
 * chosen button is the one tab stop; arrow keys move the choice. The picker
 * slot and the spinner keep their space, so the row never changes size.
 */
export function ActivityRangeControl({
  range,
  available,
  currentYear,
  loading,
  onChange,
}: {
  range: ActivityRange;
  available: SkillActivity["available"];
  currentYear: number;
  /** A new range is loading while the old chart stays on screen. */
  loading: boolean;
  onChange: (range: ActivityRange) => void;
}) {
  const s = useSettingsText();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (index: number) => {
    const bucket = BUCKETS[index]!;
    buttons.current[index]?.focus();
    if (bucket !== range.bucket) onChange(rangeForBucket(bucket, currentYear));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP[event.key];
    if (!step) return;
    event.preventDefault();
    // In Arabic the row runs right to left, so Left moves forward.
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const move = rtl && horizontal ? -step : step;
    const at = BUCKETS.indexOf(range.bucket);
    choose((at + move + BUCKETS.length) % BUCKETS.length);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label={s("Show uses by")}
        className="inline-flex gap-1.5"
        onKeyDown={onKeyDown}
      >
        {BUCKETS.map((bucket, index) => (
          <button
            key={bucket}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={range.bucket === bucket}
            tabIndex={range.bucket === bucket ? 0 : -1}
            className={cn(
              "min-h-9 rounded-[10px] border px-3 text-ui transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring",
              range.bucket === bucket
                ? "border-primary/40 bg-selection text-foreground"
                : "border-input bg-card text-muted-foreground hover:bg-interactive-hover"
            )}
            onClick={() => choose(index)}
          >
            {s(BUCKET_LABEL[bucket])}
          </button>
        ))}
      </div>
      {range.bucket === "year" ? (
        <span className="h-9 w-44" aria-hidden="true" />
      ) : (
        <Select
          className="w-44"
          aria-label={s(range.bucket === "day" ? "Days to show" : "Year to show")}
          value={pickerValue(range)}
          onChange={(event) => onChange(rangeFromPicker(range, event.target.value))}
        >
          {pickerOptions(range, available, currentYear, dateContext(), s("Last 30 days")).map(
            (option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            )
          )}
        </Select>
      )}
      <Loader
        aria-hidden="true"
        className={cn("size-4 animate-spin text-muted-foreground", !loading && "invisible")}
      />
      <span role="status" className="sr-only">
        {loading ? s("Loading…") : ""}
      </span>
    </div>
  );
}
