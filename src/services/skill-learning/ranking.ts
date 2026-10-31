import type { SkillMode } from "./proposal-store.js";
import type { SkillIndex } from "./skill-index.js";
import type { SkillStore } from "./store.js";

export const RANKING_WINDOW_MS = 30 * 86_400_000;
/** A skill needs this many uses in the window before it can be Suggested. */
export const SUGGEST_MIN_USES = 5;
/** A skill also needs this attention score before it can be Suggested. */
export const SUGGEST_MIN_ATTENTION = 0.3;

export const SKILL_ORDERS = ["uses", "attention"] as const;
export type SkillOrder = (typeof SKILL_ORDERS)[number];

export interface SkillRanking {
  name: string;
  /** Full path of its `SKILL.md`, or null when no watched folder holds it. */
  path: string | null;
  /** Shown as **Not in a watched folder**; such a skill gets no draft. */
  notInWatchedFolder: boolean;
  /** Turns in the last 30 days that used the skill. */
  uses: number;
  /** Of those turns, the ones with a failed tool call after the skill was used. */
  failedTurns: number;
  /** (failed turns + 1) / (uses + 2), rounded to 2 decimals. 0 to 1; higher needs more care. */
  attention: number;
  lastUsedAt: number | null;
  mode: SkillMode;
  /** 5 uses, attention of 0.3, and a failed turn since the skill's last proposal or review. */
  suggested: boolean;
}

// A recorded path counts only while the index still lists it. A use with no
// path takes the index path when exactly one watched skill has that name.
// Each turn counts once per skill, even when it used the skill twice.
// A failed tool call counts only when it came after the skill was used: its
// order is above the earliest use position in that turn. A NULL position (a
// row from before the column) and -1 (a slash command) count every failure.
// A review (a draft with no change, or an automatic review) counts as a proposal.
// The activity charts reuse these CTEs (idx, resolved, first_use, uses) so they
// count a use and a failed turn the same way. Parameters: the index JSON, then
// the earliest turn time.
export const USES_CTES = `
idx AS (
  SELECT json_extract(value, '$.name') AS name, json_extract(value, '$.path') AS path
  FROM json_each(?)
),
resolved AS (
  SELECT
    su.turn_id,
    su.skill_name AS name,
    CASE
      WHEN su.skill_path IS NOT NULL AND EXISTS (SELECT 1 FROM idx WHERE idx.path = su.skill_path)
        THEN su.skill_path
      WHEN su.skill_path IS NULL AND (SELECT COUNT(*) FROM idx WHERE idx.name = su.skill_name) = 1
        THEN (SELECT idx.path FROM idx WHERE idx.name = su.skill_name)
      ELSE NULL
    END AS path,
    t.created_at,
    COALESCE(su.position, -1) AS position
  FROM skill_uses su
  JOIN turns t ON t.id = su.turn_id
  WHERE t.created_at >= ?
),
first_use AS (
  SELECT turn_id, name, path, created_at, MIN(position) AS position
  FROM resolved
  GROUP BY turn_id, name, path
),
uses AS (
  SELECT
    f.turn_id,
    f.name,
    f.path,
    f.created_at,
    EXISTS (
      SELECT 1 FROM tool_calls tc
      WHERE tc.turn_id = f.turn_id AND tc.outcome = 'error' AND tc.position > f.position
    ) AS failed
  FROM first_use f
)`;

const RANKING_SQL = `
WITH ${USES_CTES},
last_proposal AS (
  SELECT path, MAX(at) AS at FROM (
    SELECT skill_path AS path, created_at AS at FROM skill_proposals WHERE skill_path IS NOT NULL
    UNION ALL
    SELECT skill_path, last_review_at FROM skill_settings WHERE last_review_at IS NOT NULL
  )
  GROUP BY path
)
SELECT
  u.name,
  u.path,
  COUNT(DISTINCT u.turn_id) AS uses,
  COUNT(DISTINCT CASE WHEN u.failed THEN u.turn_id END) AS failed_turns,
  COUNT(DISTINCT CASE WHEN u.failed AND (lp.at IS NULL OR u.created_at > lp.at) THEN u.turn_id END)
    AS failed_since_proposal,
  MAX(u.created_at) AS last_used_at,
  s.mode
FROM uses u
LEFT JOIN last_proposal lp ON lp.path = u.path
LEFT JOIN skill_settings s ON s.skill_path = u.path
GROUP BY u.name, u.path
`;

function modeOf(value: unknown): SkillMode {
  return value === "automatic" ? "automatic" : "manual";
}

/** (failed + 1) / (uses + 2): a skill with little evidence stays near the middle. */
export function attentionScore(failedTurns: number, uses: number): number {
  return Math.round(((failedTurns + 1) / (uses + 2)) * 100) / 100;
}

/**
 * Every watched skill and every recorded skill, with its 30-day counts.
 * Sorted by use count, highest first, then name; order `attention` sorts by
 * attention first, then uses, then name. Watched skills with no use are
 * listed with zero counts. Counting happens in SQL.
 */
export async function rankSkills(
  store: SkillStore,
  index: SkillIndex,
  now: number,
  order: SkillOrder = "uses"
): Promise<SkillRanking[]> {
  const db = await store.existingDb();
  const entries = index.entries.map((e) => ({ name: e.name, path: e.path }));
  const rankings: SkillRanking[] = [];
  const seen = new Set<string>();
  if (db) {
    const rows = await db.all(RANKING_SQL, [JSON.stringify(entries), now - RANKING_WINDOW_MS]);
    for (const row of rows) {
      const path = row.path == null ? null : String(row.path);
      const uses = Number(row.uses);
      const failedTurns = Number(row.failed_turns);
      const attention = attentionScore(failedTurns, uses);
      if (path) seen.add(path);
      rankings.push({
        name: String(row.name),
        path,
        notInWatchedFolder: path === null,
        uses,
        failedTurns,
        attention,
        lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
        mode: modeOf(row.mode),
        suggested:
          path !== null &&
          uses >= SUGGEST_MIN_USES &&
          attention >= SUGGEST_MIN_ATTENTION &&
          Number(row.failed_since_proposal) > 0,
      });
    }
  }
  const unused = index.entries.filter((e) => !seen.has(e.path));
  const modes = new Map<string, SkillMode>();
  if (db && unused.length > 0) {
    const rows = await db.all(
      "SELECT s.skill_path, s.mode FROM skill_settings s WHERE s.skill_path IN (SELECT value FROM json_each(?))",
      [JSON.stringify(unused.map((e) => e.path))]
    );
    for (const row of rows) modes.set(String(row.skill_path), modeOf(row.mode));
  }
  for (const entry of unused) {
    rankings.push({
      name: entry.name,
      path: entry.path,
      notInWatchedFolder: false,
      uses: 0,
      failedTurns: 0,
      attention: attentionScore(0, 0),
      lastUsedAt: null,
      mode: modes.get(entry.path) ?? "manual",
      suggested: false,
    });
  }
  const byUses = (a: SkillRanking, b: SkillRanking) =>
    b.uses - a.uses || a.name.localeCompare(b.name);
  return rankings.sort(
    order === "attention" ? (a, b) => b.attention - a.attention || byUses(a, b) : byUses
  );
}
