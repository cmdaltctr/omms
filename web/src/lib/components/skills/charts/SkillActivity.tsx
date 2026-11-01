import { useEffect, useState } from "react";
import { Loader } from "lucide-react";
import { dateContext } from "$lib/format";
import { useSettingsText } from "$lib/i18n/settings";
import { readPreference, writePreference } from "$lib/preferences";
import {
  RANGE_KEY,
  TOP_LOADED,
  USES_TITLE,
  checkRange,
  noUses,
  normaliseActivity,
  periodName,
  rangeRequest,
  rangeText,
  readRange,
  type ActivityRange,
} from "$lib/skill-activity";
import {
  skillsApi,
  type ProposalSummary,
  type SkillActivity,
  type TopSkill,
} from "$lib/skills-api";
import { countText, fill } from "$lib/skills-model";
import { cn } from "$lib/utils";
import { ActivityRangeControl } from "./ActivityRangeControl";
import { PipelineChart } from "./PipelineChart";
import { TopSkillsChart } from "./TopSkillsChart";
import { UsesChart } from "./UsesChart";

const NO_DATA = { months: [], years: [] };
const CHARTS_APPEAR = "The use charts appear after OMMS records agent turns that use a skill.";

type ViewProps = {
  /** null while the first range loads. */
  activity: SkillActivity | null;
  /** The chosen range. */
  range: ActivityRange;
  /** The range `activity` covers. It lags `range` while a new range loads. */
  shownRange?: ActivityRange;
  loading: boolean;
  error: string;
  proposals: readonly ProposalSummary[];
  onOpen: (skill: TopSkill) => void;
  onRange: (range: ActivityRange) => void;
};

/** The empty-state sentence for the shown window. */
function emptyText(range: ActivityRange, period: string, s: (message: string) => string) {
  if (range.bucket === "year") return `${s("No skill uses are recorded yet.")} ${s(CHARTS_APPEAR)}`;
  if (range.bucket === "day" && !range.month) {
    return s(
      "No skill uses are recorded in the last 30 days. The use charts appear after OMMS records agent turns that use a skill."
    );
  }
  return `${fill(s("No skill uses are recorded in {period}."), { period })} ${s(CHARTS_APPEAR)}`;
}

/**
 * The Activity section as markup: a range control, a one-line count strip,
 * the uses chart on its own row, then the top skills and the pipeline.
 */
export function SkillActivityView({
  activity,
  range,
  shownRange = range,
  loading,
  error,
  proposals,
  onOpen,
  onRange,
}: ViewProps) {
  const s = useSettingsText();
  const ctx = dateContext();
  const empty = activity !== null && noUses(activity.series);
  const period = activity ? periodName(shownRange, activity.series, ctx, s) : "";
  const lastDays = shownRange.bucket === "day" && !shownRange.month;
  const busy = loading && activity !== null;
  // The pipeline does not depend on the range, so only the range's parts dim.
  const dim = cn("transition-opacity duration-150", busy && "opacity-60");
  return (
    <section
      id="skills-section-activity"
      className="scroll-mt-4 space-y-3"
      aria-labelledby="skills-activity-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="skills-activity-title" className="text-section-title font-semibold">
          {s("Activity")}
        </h2>
        <ActivityRangeControl
          range={range}
          available={activity?.available ?? NO_DATA}
          currentYear={new Date().getUTCFullYear()}
          loading={busy}
          onChange={onRange}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive-label">
          {s("Activity could not load.")} {error}
        </p>
      ) : null}
      {activity === null && !error ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {s("Loading…")}
        </p>
      ) : null}
      <div aria-busy={busy || undefined} className="space-y-3">
        {activity ? (
          <dl className={cn("flex flex-wrap gap-x-6 gap-y-1 text-sm", dim)}>
            {[
              [
                lastDays ? s("Uses in 30 days") : fill(s("Uses in {period}"), { period }),
                activity.totals.uses,
              ],
              [s("Failed turns"), activity.totals.failed],
              [s("Active skills"), activity.totals.activeSkills],
            ].map(([term, value]) => (
              <div key={term} className="flex items-baseline gap-1.5">
                <dt className="text-muted-foreground">{term}</dt>
                <dd className="font-semibold tabular-nums">{countText(Number(value))}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {activity && empty ? (
          <p className="text-sm text-muted-foreground">{emptyText(shownRange, period, s)}</p>
        ) : null}
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
          {activity && !empty ? (
            <>
              <UsesChart
                className={cn("lg:col-span-2", dim)}
                rows={activity.series}
                bucket={activity.bucket}
                period={period}
                title={s(USES_TITLE[activity.bucket])}
              />
              <TopSkillsChart
                key={rangeText(shownRange)}
                className={dim}
                skills={activity.topSkills}
                total={activity.topTotal}
                onOpen={onOpen}
              />
            </>
          ) : null}
          <PipelineChart proposals={proposals} />
        </div>
      </div>
    </section>
  );
}

type Shown = { range: ActivityRange; activity: SkillActivity };

/**
 * Owns the range. It starts from the range this browser saved, and falls
 * back to the last 30 days when that month or year has no data any more. A
 * new range keeps the old charts on screen until its data arrives. A failure
 * leaves the rest of the page working.
 */
export function SkillActivitySection({
  proposals,
  onOpen,
  reloadKey,
}: Pick<ViewProps, "proposals" | "onOpen"> & { reloadKey: number }) {
  const [range, setRange] = useState<ActivityRange>(() =>
    readRange(readPreference(RANGE_KEY, RANGE_KEY))
  );
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const choose = (next: ActivityRange) => {
    writePreference(RANGE_KEY, rangeText(next));
    setRange(next);
  };
  useEffect(() => {
    let live = true;
    setLoading(true);
    void skillsApi.activity({ ...rangeRequest(range), top: TOP_LOADED }).then((reply) => {
      if (!live) return;
      if (!reply.ok) {
        setError(reply.error);
        setLoading(false);
        return;
      }
      const activity = normaliseActivity(reply.data);
      const checked = checkRange(range, activity.available);
      if (checked !== range) {
        // The saved month or year has no data any more; load the default instead.
        writePreference(RANGE_KEY, rangeText(checked));
        setRange(checked);
        return;
      }
      setShown({ range, activity });
      setError("");
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [range, reloadKey]);
  return (
    <SkillActivityView
      activity={shown?.activity ?? null}
      range={range}
      shownRange={shown?.range ?? range}
      {...{ loading, error, proposals, onOpen }}
      onRange={choose}
    />
  );
}
