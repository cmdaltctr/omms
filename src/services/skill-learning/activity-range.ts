import { intParam } from "./query-params.js";

/*
 * The time window of the Skills page activity charts: which UTC periods the
 * chart shows, and how the route reads them from the query. Pure, so the
 * window maths is tested without a database.
 */

const DAY_MS = 86_400_000;
export const ACTIVITY_DEFAULT_DAYS = 30;
export const ACTIVITY_MAX_DAYS = 90;
export const ACTIVITY_BUCKETS = ["day", "month", "year"] as const;
export type ActivityBucket = (typeof ACTIVITY_BUCKETS)[number];
/** Date.UTC reads a year below 100 as 1900 and up, so the earliest year is 1970. */
const MIN_YEAR = 1970;
const MAX_YEAR = 9999;

/** Which periods to count: the last N days, one calendar month, one year, or every year. */
export type ActivityQuery =
  | { bucket: "day"; days: number }
  | { bucket: "day"; month: string }
  | { bucket: "month"; year: number }
  | { bucket: "year" };

export interface ActivityWindow {
  /** First instant counted, UTC milliseconds. */
  start: number;
  /** First instant after the window. */
  end: number;
  /** One key per bar, oldest first: `YYYY-MM-DD`, `YYYY-MM` or `YYYY`. */
  keys: string[];
}

/** The SQL that turns a use time into its bucket key. */
export const BUCKET_SQL: Record<ActivityBucket, string> = {
  day: `date(u.created_at / 1000, 'unixepoch')`,
  month: `strftime('%Y-%m', u.created_at / 1000, 'unixepoch')`,
  year: `strftime('%Y', u.created_at / 1000, 'unixepoch')`,
};

const pad = (value: number) => String(value).padStart(2, "0");
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const utcYear = (now: number) => new Date(now).getUTCFullYear();

/**
 * The window for a query. `firstYear` is the year of the earliest recorded
 * use; the year bucket starts there and always reaches the year of `now`.
 */
export function activityWindow(
  query: ActivityQuery,
  now: number,
  firstYear: number | null
): ActivityWindow {
  if (query.bucket === "year") {
    const last = utcYear(now);
    const first = Math.min(firstYear ?? last, last);
    const keys = Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
    return { start: Date.UTC(first, 0, 1), end: Date.UTC(last + 1, 0, 1), keys };
  }
  if (query.bucket === "month") {
    const keys = Array.from({ length: 12 }, (_, i) => `${query.year}-${pad(i + 1)}`);
    return { start: Date.UTC(query.year, 0, 1), end: Date.UTC(query.year + 1, 0, 1), keys };
  }
  if ("month" in query) {
    const [year, month] = query.month.split("-").map(Number) as [number, number];
    const start = Date.UTC(year, month - 1, 1);
    const end = Date.UTC(year, month, 1);
    const keys = Array.from({ length: (end - start) / DAY_MS }, (_, i) =>
      dayKey(start + i * DAY_MS)
    );
    return { start, end, keys };
  }
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const start = today - (query.days - 1) * DAY_MS;
  const keys = Array.from({ length: query.days }, (_, i) => dayKey(start + i * DAY_MS));
  return { start, end: today + DAY_MS, keys };
}

export const ACTIVITY_DEFAULT_TOP = 8;
export const ACTIVITY_MAX_TOP = 100;

/** How many of the most used skills to return: `top`, 1 to 100, default 8. */
export const topParam = (url: URL): number =>
  intParam(url, "top", 1, ACTIVITY_MAX_TOP, ACTIVITY_DEFAULT_TOP);

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * The query from `bucket`, `days`, `month` and `year`. Numbers are clamped
 * like every other Skills route number. An unknown bucket or a month that is
 * not `YYYY-MM` from 1970 on gives an error, like an unknown `order`. With
 * the day bucket, `month` wins over `days`.
 */
export function parseActivityQuery(url: URL, now: number): ActivityQuery | { error: string } {
  const bucket = url.searchParams.get("bucket")?.trim() || "day";
  if (!(ACTIVITY_BUCKETS as readonly string[]).includes(bucket)) {
    return { error: `bucket must be one of: ${ACTIVITY_BUCKETS.join(", ")}` };
  }
  if (bucket === "year") return { bucket };
  if (bucket === "month") {
    return { bucket, year: intParam(url, "year", MIN_YEAR, MAX_YEAR, utcYear(now)) };
  }
  const month = url.searchParams.get("month")?.trim();
  if (month) {
    const match = MONTH.exec(month);
    if (!match || Number(match[1]) < MIN_YEAR) {
      return { error: `month must be YYYY-MM, from ${MIN_YEAR}-01` };
    }
    return { bucket: "day", month };
  }
  return {
    bucket: "day",
    days: intParam(url, "days", 1, ACTIVITY_MAX_DAYS, ACTIVITY_DEFAULT_DAYS),
  };
}
