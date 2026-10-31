import type { TursoDb } from "../turso/turso-db.js";
import {
  ACTIVITY_DEFAULT_TOP,
  BUCKET_SQL,
  activityWindow,
  utcYear,
  type ActivityBucket,
  type ActivityQuery,
} from "./activity-range.js";
import { USES_CTES } from "./ranking.js";
import type { SkillIndex } from "./skill-index.js";
import type { SkillStore } from "./store.js";

/** The per-skill chart always shows this many days. */
export const SKILL_DAILY_DAYS = 30;
export { ACTIVITY_DEFAULT_DAYS, ACTIVITY_MAX_DAYS } from "./activity-range.js";

export interface DailyUses {
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
  /** Turns that used the skill that day. */
  uses: number;
  /** Of those turns, the ones with a failed tool call after the skill was used. */
  failed: number;
}

/** Uses in one UTC period: a day `YYYY-MM-DD`, a month `YYYY-MM` or a year `YYYY`. */
export interface PeriodUses {
  key: string;
  uses: number;
  failed: number;
}

export interface SkillActivity {
  bucket: ActivityBucket;
  /** One entry per period of the window, oldest first, zero-filled. */
  series: PeriodUses[];
  /** The day series as `{ day }` rows, as before. Empty for months and years. */
  days: DailyUses[];
  topSkills: { name: string; path: string | null; uses: number; failed: number }[];
  /** Distinct skills used in the window, so a list of the top skills knows when to stop. */
  topTotal: number;
  totals: { uses: number; failed: number; activeSkills: number };
  /** Months with a use, and years with a use plus this year, newest first. */
  available: { months: string[]; years: number[] };
}

function fillKeys(keys: string[], rows: Record<string, unknown>[]): PeriodUses[] {
  const byKey = new Map(rows.map((r) => [String(r.key), r]));
  return keys.map((key) => {
    const row = byKey.get(key);
    return { key, uses: Number(row?.uses ?? 0), failed: Number(row?.failed ?? 0) };
  });
}

const asDays = (series: PeriodUses[]): DailyUses[] =>
  series.map(({ key, uses, failed }) => ({ day: key, uses, failed }));

const entriesJson = (index: SkillIndex) =>
  JSON.stringify(index.entries.map((e) => ({ name: e.name, path: e.path })));

/**
 * One skill's uses and failed turns for each of the last 30 UTC days, oldest
 * first, with zero days included. A missing `skills.db` gives all zeros and
 * stays missing.
 */
export async function skillDaily(
  store: SkillStore,
  index: SkillIndex,
  skill: { name: string; path: string | null },
  now: number
): Promise<DailyUses[]> {
  const window = activityWindow({ bucket: "day", days: SKILL_DAILY_DAYS }, now, null);
  const db = await store.existingDb();
  if (!db) return asDays(fillKeys(window.keys, []));
  const rows = await db.all(
    `WITH ${USES_CTES}
     SELECT ${BUCKET_SQL.day} AS key, COUNT(*) AS uses, SUM(u.failed) AS failed
     FROM uses u
     WHERE u.name = ? AND ${skill.path ? "u.path = ?" : "u.path IS NULL"}
     GROUP BY key`,
    [entriesJson(index), window.start, skill.name, ...(skill.path ? [skill.path] : [])]
  );
  return asDays(fillKeys(window.keys, rows));
}

/** Every month with a use, newest first, and those years plus the year of `now`. */
async function availablePeriods(db: TursoDb | null, json: string, now: number) {
  const rows = db
    ? await db.all(
        `WITH ${USES_CTES}
         SELECT DISTINCT ${BUCKET_SQL.month} AS month FROM uses u ORDER BY month DESC`,
        [json, 0]
      )
    : [];
  const months = rows.map((r) => String(r.month));
  const years = [...new Set([utcYear(now), ...months.map((m) => Number(m.slice(0, 4)))])];
  return { months, years: years.sort((a, b) => b - a) };
}

/**
 * Uses and failed turns per UTC period across all skills, the `top` most used
 * skills in the same window (8 by default), and the window totals. Counts a use like the
 * ranking does, so a turn that used two skills counts once for each. A number
 * asks for that many days ending today, as before.
 */
export async function skillActivity(
  store: SkillStore,
  index: SkillIndex,
  now: number,
  request: ActivityQuery | number,
  top = ACTIVITY_DEFAULT_TOP
): Promise<SkillActivity> {
  const query: ActivityQuery =
    typeof request === "number" ? { bucket: "day", days: request } : request;
  const db = await store.existingDb();
  const json = entriesJson(index);
  const available = await availablePeriods(db, json, now);
  const oldest = available.months.at(-1);
  const window = activityWindow(query, now, oldest ? Number(oldest.slice(0, 4)) : null);
  // The CTEs take the index and the window start; the end bounds the window.
  const args = [json, window.start, window.end];
  const keyRows = db
    ? await db.all(
        `WITH ${USES_CTES}
         SELECT ${BUCKET_SQL[query.bucket]} AS key, COUNT(*) AS uses, SUM(u.failed) AS failed
         FROM uses u WHERE u.created_at < ? GROUP BY key`,
        args
      )
    : [];
  const skillRows = db
    ? await db.all(
        `WITH ${USES_CTES}
         SELECT u.name, u.path, COUNT(*) AS uses, SUM(u.failed) AS failed
         FROM uses u WHERE u.created_at < ? GROUP BY u.name, u.path
         ORDER BY uses DESC, u.name ASC, u.path ASC`,
        args
      )
    : [];
  const series = fillKeys(window.keys, keyRows);
  const skills = skillRows.map((r) => ({
    name: String(r.name),
    path: r.path == null ? null : String(r.path),
    uses: Number(r.uses),
    failed: Number(r.failed),
  }));
  return {
    bucket: query.bucket,
    series,
    days: query.bucket === "day" ? asDays(series) : [],
    topSkills: skills.slice(0, top),
    topTotal: skills.length,
    totals: {
      uses: series.reduce((n, d) => n + d.uses, 0),
      failed: series.reduce((n, d) => n + d.failed, 0),
      activeSkills: skills.length,
    },
    available,
  };
}
