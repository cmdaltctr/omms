import { formatDateOnlyWith, formatDayWith, type DateFormatChoice } from "./date-format";
import type {
  ActivityBucket,
  ActivityRequest,
  DailyUse,
  HistoryEntry,
  HistoryKind,
  PeriodUse,
  Proposal,
  ProposalState,
  SkillActivity,
  SkillHistoryPage,
  TopSkill,
} from "./skills-api";
import { fill } from "./skills-model";

/*
 * Pure helpers for the Skills charts and the History timeline. A missing or
 * malformed field from an older server reads as empty, never as a crash.
 */

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export function normaliseDays(value: unknown): DailyUse[] {
  return list(value)
    .map(record)
    .filter((day) => typeof day.day === "string")
    .map((day) => ({ day: day.day as string, uses: count(day.uses), failed: count(day.failed) }));
}

export const dayRows = (days: readonly DailyUse[]): PeriodUse[] =>
  days.map(({ day, uses, failed }) => ({ key: day, uses, failed }));

const BUCKETS: readonly ActivityBucket[] = ["day", "month", "year"];
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

function normaliseAvailable(value: unknown): SkillActivity["available"] {
  const data = record(value);
  return {
    months: list(data.months).filter(
      (m): m is string => typeof m === "string" && MONTH_KEY.test(m)
    ),
    years: list(data.years).filter((y): y is number => Number.isInteger(y)),
  };
}

/** An older server sends only `days`; its series is the day list. */
export function normaliseActivity(value: unknown): SkillActivity {
  const data = record(value);
  const totals = record(data.totals);
  const days = normaliseDays(data.days);
  const series: PeriodUse[] = Array.isArray(data.series)
    ? data.series
        .map(record)
        .filter((row) => typeof row.key === "string")
        .map((row) => ({
          key: row.key as string,
          uses: count(row.uses),
          failed: count(row.failed),
        }))
    : dayRows(days);
  const topSkills: TopSkill[] = list(data.topSkills)
    .map(record)
    .filter((skill) => typeof skill.name === "string")
    .map((skill) => ({
      name: skill.name as string,
      path: typeof skill.path === "string" ? skill.path : null,
      uses: count(skill.uses),
      failed: count(skill.failed),
    }));
  return {
    bucket: BUCKETS.includes(data.bucket as ActivityBucket)
      ? (data.bucket as ActivityBucket)
      : "day",
    series,
    days,
    topSkills,
    topTotal: Math.max(count(data.topTotal), topSkills.length),
    totals: {
      uses: count(totals.uses),
      failed: count(totals.failed),
      activeSkills: count(totals.activeSkills),
    },
    available: normaliseAvailable(data.available),
  };
}

const KINDS: readonly HistoryKind[] = ["created", "applied", "rejected", "undone", "stale"];

export function normaliseHistory(value: unknown): SkillHistoryPage {
  const data = record(value);
  const entries: HistoryEntry[] = list(data.entries)
    .map(record)
    .filter((entry) => KINDS.includes(entry.kind as HistoryKind) && typeof entry.id === "string")
    .map((entry) => ({
      id: entry.id as string,
      proposalId: typeof entry.proposalId === "string" ? entry.proposalId : "",
      kind: entry.kind as HistoryKind,
      at: count(entry.at),
      summary: typeof entry.summary === "string" ? entry.summary : "",
      appliedBy: typeof entry.appliedBy === "string" ? entry.appliedBy : null,
      versionId: typeof entry.versionId === "string" ? entry.versionId : null,
      canUndo: entry.canUndo === true,
      laterAppliedCount: count(entry.laterAppliedCount),
      added: count(entry.added),
      removed: count(entry.removed),
    }));
  return { total: Math.max(count(data.total), entries.length), entries };
}

/** True when no period has a use, so the charts show their empty state. */
export const noUses = (rows: readonly { uses: number }[]): boolean =>
  rows.every((row) => row.uses === 0);

/** Successful uses are the uses without a failed turn. Stacked bars show both parts. */
export const withSuccess = <T extends { uses: number; failed: number }>(row: T) => ({
  ...row,
  succeeded: Math.max(0, row.uses - row.failed),
  failed: Math.min(row.failed, row.uses),
});

export const PIPELINE_STATES: readonly ProposalState[] = [
  "pending",
  "applied",
  "rejected",
  "stale",
  "undone",
];

/** Proposals per state, in pipeline order, from the proposals the page already holds. */
export function pipelineCounts(proposals: readonly Pick<Proposal, "state">[]) {
  return PIPELINE_STATES.map((state) => ({
    state,
    count: proposals.filter((proposal) => proposal.state === state).length,
  }));
}

/** A `YYYY-MM-DD` day at local noon, so formatting shows the same day in every time zone. */
export const dayTime = (day: string): number => Date.parse(`${day}T12:00:00`);

/*
 * The Activity range: Days (the last 30 days, or one month), Months (one
 * year) or Years (every year with a use). One choice drives the whole section.
 */
export type ActivityRange =
  { bucket: "day"; month: string | null } | { bucket: "month"; year: number } | { bucket: "year" };

export const DEFAULT_RANGE: ActivityRange = { bucket: "day", month: null };
/** Per-browser key of the remembered range. */
export const RANGE_KEY = "omms-skills-activity-range";
export const LAST_DAYS_VALUE = "last-30";
const LAST_DAYS = 30;
/** Most used skills: rows shown at first and added by each Show more. */
export const TOP_STEP = 8;
/** The section asks for this many top skills once per range and pages them here. */
export const TOP_LOADED = 100;

/** Rows after Show more: 8 more, up to every loaded skill. */
export const moreTop = (shown: number, loaded: number): number =>
  Math.min(loaded, shown + TOP_STEP);

/** English messages; the components translate them. */
export const USES_TITLE: Record<ActivityBucket, string> = {
  day: "Uses per day",
  month: "Uses per month",
  year: "Uses per year",
};
export const PERIOD_COLUMN: Record<ActivityBucket, string> = {
  day: "Day",
  month: "Month",
  year: "Year",
};

export function rangeRequest(range: ActivityRange): ActivityRequest {
  if (range.bucket === "year") return { bucket: "year" };
  if (range.bucket === "month") return { bucket: "month", year: range.year };
  return range.month ? { bucket: "day", month: range.month } : { bucket: "day", days: LAST_DAYS };
}

/** The saved text of a range: `day`, `day:YYYY-MM`, `month:YYYY` or `year`. */
export function rangeText(range: ActivityRange): string {
  if (range.bucket === "year") return "year";
  if (range.bucket === "month") return `month:${range.year}`;
  return range.month ? `day:${range.month}` : "day";
}

export function readRange(raw: string | null): ActivityRange {
  if (raw === "year") return { bucket: "year" };
  const month = /^day:(\d{4}-\d{2})$/.exec(raw ?? "")?.[1];
  if (month && MONTH_KEY.test(month)) return { bucket: "day", month };
  const year = /^month:(\d{4})$/.exec(raw ?? "")?.[1];
  if (year) return { bucket: "month", year: Number(year) };
  return DEFAULT_RANGE;
}

/** The same range while its month or year still has data, else the last 30 days. */
export function checkRange(
  range: ActivityRange,
  available: SkillActivity["available"]
): ActivityRange {
  if (range.bucket === "day" && range.month && !available.months.includes(range.month)) {
    return DEFAULT_RANGE;
  }
  if (range.bucket === "month" && !available.years.includes(range.year)) return DEFAULT_RANGE;
  return range;
}

/** Where a new choice of Days, Months or Years starts. */
export function rangeForBucket(bucket: ActivityBucket, currentYear: number): ActivityRange {
  if (bucket === "year") return { bucket };
  return bucket === "month" ? { bucket, year: currentYear } : DEFAULT_RANGE;
}

export const pickerValue = (range: ActivityRange): string =>
  range.bucket === "month"
    ? String(range.year)
    : range.bucket === "day"
      ? (range.month ?? LAST_DAYS_VALUE)
      : "";

export function rangeFromPicker(range: ActivityRange, value: string): ActivityRange {
  if (range.bucket === "month") return { bucket: "month", year: Number(value) };
  return value === LAST_DAYS_VALUE ? DEFAULT_RANGE : { bucket: "day", month: value };
}

/** How the page formats dates: its locale and the user's date style. */
export type LabelContext = { locale: string; choice: DateFormatChoice };

/**
 * A period key as text. Days follow the user's date style, as elsewhere.
 * Months use the Gregorian calendar in UTC, so `ar-SA` does not switch to
 * Hijri months. `full` adds the year for tooltips and tables.
 */
export function periodLabel(
  bucket: ActivityBucket,
  key: string,
  full: boolean,
  ctx: LabelContext
): string {
  if (bucket === "year") return key;
  if (bucket === "day") {
    const date = new Date(dayTime(key));
    return full
      ? formatDateOnlyWith(date, ctx.choice, ctx.locale)
      : formatDayWith(date, ctx.choice, ctx.locale);
  }
  const [year, month] = key.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat(ctx.locale, {
    month: full ? "long" : "short",
    ...(full ? { year: "numeric" } : {}),
    timeZone: "UTC",
    calendar: "gregory",
  }).format(Date.UTC(year, month - 1, 1));
}

/** The window of the shown numbers, for the summary line and the count strip. */
export function periodName(
  range: ActivityRange,
  series: readonly PeriodUse[],
  ctx: LabelContext,
  s: (message: string) => string
): string {
  if (range.bucket === "month") return String(range.year);
  if (range.bucket === "day") {
    return range.month ? periodLabel("month", range.month, true, ctx) : s("Last 30 days");
  }
  const from = series[0]?.key ?? "";
  const to = series.at(-1)?.key ?? "";
  return from === to ? to : fill(s("{from} to {to}"), { from, to });
}

/** The picker under Days or Months, newest first. The chosen value is always listed. */
export function pickerOptions(
  range: ActivityRange,
  available: SkillActivity["available"],
  currentYear: number,
  ctx: LabelContext,
  lastDaysLabel: string
): { value: string; label: string }[] {
  if (range.bucket === "year") return [];
  if (range.bucket === "month") {
    const years = [...new Set([currentYear, range.year, ...available.years])];
    return years
      .sort((a, b) => b - a)
      .map((year) => ({ value: String(year), label: String(year) }));
  }
  const months = [...new Set([...(range.month ? [range.month] : []), ...available.months])];
  return [
    { value: LAST_DAYS_VALUE, label: lastDaysLabel },
    ...months
      .sort((a, b) => b.localeCompare(a))
      .map((month) => ({ value: month, label: periodLabel("month", month, true, ctx) })),
  ];
}
