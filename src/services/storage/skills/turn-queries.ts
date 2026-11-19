import type { TursoDb } from "../../turso/turso-db.js";

/*
 * Read queries over the recorded turns in `skills.db`: the ranking, the
 * activity charts, the turns sent to a draft, the Skills page turn list, the
 * failed calls and the agent evidence. Each function takes a connection from
 * `SkillStore.existingDb()` or `SkillStore.db()` and returns the raw rows;
 * the callers in `skill-learning/` turn them into their own shapes.
 */

/** A `skills.db` connection, as `SkillStore.existingDb()` and `SkillStore.db()` give it. */
export type SkillsDb = TursoDb;

type Row = Record<string, unknown>;

/** The watched skills, as the skill index lists them. */
type IndexEntries = readonly { name: string; path: string }[];

/** A skill as a page names it; `path` is null when no watched folder holds it. */
type SkillName = { name: string; path: string | null };

/**
 * A watched skill and whether a use recorded without a path counts for it:
 * true when exactly one watched skill has this name.
 */
type SkillMatch = { name: string; path: string; byName: boolean };

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
const USES_CTES = `
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

// --- Ranking ---------------------------------------------------------------

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

/**
 * One row per used skill since `since`: `name`, `path`, `uses`,
 * `failed_turns`, `failed_since_proposal`, `last_used_at` and `mode`.
 * `entriesJson` is the index as `[{ name, path }]` JSON.
 */
export function rankingRows(db: SkillsDb, entriesJson: string, since: number): Promise<Row[]> {
  return db.all(RANKING_SQL, [entriesJson, since]);
}

/** The newest apply time (`at`) per `skill_path` and `skill_name` of the applied proposals. */
export function appliedProposalRows(db: SkillsDb): Promise<Row[]> {
  return db.all(
    `SELECT skill_path, skill_name, MAX(updated_at) AS at FROM skill_proposals
     WHERE state = 'applied' GROUP BY skill_path, skill_name`
  );
}

/** `skill_path` and `mode` of the saved settings for the paths in `pathsJson`. */
export function skillModeRows(db: SkillsDb, pathsJson: string): Promise<Row[]> {
  return db.all(
    "SELECT s.skill_path, s.mode FROM skill_settings s WHERE s.skill_path IN (SELECT value FROM json_each(?))",
    [pathsJson]
  );
}

// --- Activity charts -------------------------------------------------------

/** The SQL that turns a use time into its bucket key. */
const BUCKET_SQL: Record<"day" | "month" | "year", string> = {
  day: `date(u.created_at / 1000, 'unixepoch')`,
  month: `strftime('%Y-%m', u.created_at / 1000, 'unixepoch')`,
  year: `strftime('%Y', u.created_at / 1000, 'unixepoch')`,
};

/** One skill's `key` (UTC day), `uses` and `failed` per day from `start`. */
export function dailyUseRows(
  db: SkillsDb,
  entriesJson: string,
  start: number,
  skill: SkillName
): Promise<Row[]> {
  return db.all(
    `WITH ${USES_CTES}
     SELECT ${BUCKET_SQL.day} AS key, COUNT(*) AS uses, SUM(u.failed) AS failed
     FROM uses u
     WHERE u.name = ? AND ${skill.path ? "u.path = ?" : "u.path IS NULL"}
     GROUP BY key`,
    [entriesJson, start, skill.name, ...(skill.path ? [skill.path] : [])]
  );
}

/** Every month (`YYYY-MM`) with a use, newest first. */
export function usedMonthRows(db: SkillsDb, entriesJson: string): Promise<Row[]> {
  return db.all(
    `WITH ${USES_CTES}
         SELECT DISTINCT ${BUCKET_SQL.month} AS month FROM uses u ORDER BY month DESC`,
    [entriesJson, 0]
  );
}

/** `key`, `uses` and `failed` per bucket in `[start, end)`, across all skills. */
export function bucketUseRows(
  db: SkillsDb,
  bucket: "day" | "month" | "year",
  entriesJson: string,
  start: number,
  end: number
): Promise<Row[]> {
  return db.all(
    `WITH ${USES_CTES}
         SELECT ${BUCKET_SQL[bucket]} AS key, COUNT(*) AS uses, SUM(u.failed) AS failed
         FROM uses u WHERE u.created_at < ? GROUP BY key`,
    [entriesJson, start, end]
  );
}

/** `name`, `path`, `uses` and `failed` per skill in `[start, end)`, most used first. */
export function skillUseRows(
  db: SkillsDb,
  entriesJson: string,
  start: number,
  end: number
): Promise<Row[]> {
  return db.all(
    `WITH ${USES_CTES}
         SELECT u.name, u.path, COUNT(*) AS uses, SUM(u.failed) AS failed
         FROM uses u WHERE u.created_at < ? GROUP BY u.name, u.path
         ORDER BY uses DESC, u.name ASC, u.path ASC`,
    [entriesJson, start, end]
  );
}

// --- Draft turns -----------------------------------------------------------

/** The `skill_uses` rows (alias `su`) that count for a skill; bind `useArgs(ref)`. */
const USES_WHERE = "(su.skill_path = ? OR (su.skill_path IS NULL AND su.skill_name = ? AND ? = 1))";

function useArgs(ref: SkillMatch): Array<string | number> {
  return [ref.path, ref.name, ref.byName ? 1 : 0];
}

/** Recorded turns that used the skill, all time. A turn counts once. */
export async function skillUseCount(db: SkillsDb, ref: SkillMatch): Promise<number> {
  const row = await db.get(
    `SELECT COUNT(DISTINCT su.turn_id) AS n FROM skill_uses su WHERE ${USES_WHERE}`,
    useArgs(ref)
  );
  return Number(row?.n ?? 0);
}

function turnRows(db: SkillsDb, where: string, args: Array<string | number>): Promise<Row[]> {
  return db.all(
    `SELECT t.id, t.created_at, t.prompt, t.replies_json FROM turns t
     WHERE ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
    args
  );
}

/** `id`, `created_at`, `prompt` and `replies_json` of the newest turns that used the skill. */
export function skillTurnRows(db: SkillsDb, ref: SkillMatch, limit: number): Promise<Row[]> {
  return turnRows(db, `t.id IN (SELECT su.turn_id FROM skill_uses su WHERE ${USES_WHERE})`, [
    ...useArgs(ref),
    limit,
  ]);
}

/** The newest recorded turns of any kind, as `skillTurnRows` gives them. */
export function newestTurnRows(db: SkillsDb, limit: number): Promise<Row[]> {
  return turnRows(db, "1 = 1", [limit]);
}

/** The turns with the ids in `idsJson` that still exist, newest first. */
export function turnRowsByIds(db: SkillsDb, idsJson: string, limit: number): Promise<Row[]> {
  return turnRows(db, "t.id IN (SELECT value FROM json_each(?))", [idsJson, limit]);
}

/** `turn_id`, `name`, `outcome` and `error` of the tool calls of the turns in `idsJson`, in order. */
export function turnToolCallRows(db: SkillsDb, idsJson: string): Promise<Row[]> {
  return db.all(
    `SELECT turn_id, name, outcome, error FROM tool_calls
     WHERE turn_id IN (SELECT value FROM json_each(?)) ORDER BY turn_id, position`,
    [idsJson]
  );
}

// --- Turn summaries --------------------------------------------------------

/** The Skills page shows this much of a prompt. */
export const PROMPT_PREVIEW_CHARS = 200;

const COLUMNS = `t.id, t.created_at, t.host, t.project_name,
  substr(t.prompt, 1, ${PROMPT_PREVIEW_CHARS}) AS preview,
  (SELECT COUNT(*) FROM tool_calls tc WHERE tc.turn_id = t.id AND tc.outcome = 'error') AS failed`;

// The same use-to-skill rule as the ranking: a recorded path counts while the
// index lists it; a use with no path belongs to the one watched skill with its name.
const BY_PATH = `
SELECT su.turn_id, su.position FROM skill_uses su
WHERE su.skill_path = ? OR (su.skill_path IS NULL AND su.skill_name = ? AND ? = 1)`;

const BY_NAME = `
SELECT su.turn_id, su.position FROM skill_uses su
WHERE su.skill_name = ? AND (
  (su.skill_path IS NOT NULL AND su.skill_path NOT IN (SELECT value FROM json_each(?)))
  OR (su.skill_path IS NULL AND ? = 0)
)`;

/** The SQL that selects a skill's uses (turn id and position), and its parameters. */
function skillUsesFor(skill: SkillName, entries: IndexEntries) {
  const named = entries.filter((e) => e.name === skill.name);
  return skill.path
    ? {
        sql: BY_PATH,
        args: [skill.path, skill.name, named.length === 1 && named[0]!.path === skill.path ? 1 : 0],
      }
    : {
        sql: BY_NAME,
        args: [skill.name, JSON.stringify(entries.map((e) => e.path)), named.length === 1 ? 1 : 0],
      };
}

/** The SQL that selects a skill's turn ids, and its parameters. */
function turnIdsFor(skill: SkillName, entries: IndexEntries) {
  const uses = skillUsesFor(skill, entries);
  return { sql: `SELECT turn_id FROM (${uses.sql})`, args: uses.args };
}

/**
 * `id`, `created_at`, `host`, `project_name`, `preview` and `failed` of the
 * turns that used one skill, newest first, `limit` of them after `offset`.
 */
export function skillTurnSummaryRows(
  db: SkillsDb,
  skill: SkillName,
  entries: IndexEntries,
  limit: number,
  offset: number
): Promise<Row[]> {
  const ids = turnIdsFor(skill, entries);
  return db.all(
    `SELECT ${COLUMNS} FROM turns t WHERE t.id IN (${ids.sql})
     ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...ids.args, limit, offset]
  );
}

/** How many recorded turns used this skill. */
export async function skillTurnCount(
  db: SkillsDb,
  skill: SkillName,
  entries: IndexEntries
): Promise<number> {
  const ids = turnIdsFor(skill, entries);
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM turns t WHERE t.id IN (${ids.sql})`,
    ids.args
  );
  return Number(row?.n ?? 0);
}

/** The turns with the ids in `idsJson`, as `skillTurnSummaryRows` gives them, newest first. */
export function turnSummaryRowsByIds(db: SkillsDb, idsJson: string): Promise<Row[]> {
  return db.all(
    `SELECT ${COLUMNS} FROM turns t WHERE t.id IN (SELECT value FROM json_each(?))
     ORDER BY t.created_at DESC, t.id DESC`,
    [idsJson]
  );
}

// --- Failed calls ----------------------------------------------------------

/** The server sends at most this many characters of one call's input (design §3). */
export const FAILURE_INPUT_CAP = 20_000;
/** A group key is the first line of the error text, cut to this length (design §4). */
export const FAILURE_LINE_CHARS = 200;
/** How many of a group's latest calls the reply carries. */
export const FAILURE_SAMPLE = 5;
/** How many groups the reply carries, most calls first. */
export const FAILURE_GROUP_LIMIT = 50;

// An empty error text is no error text, as a null one is: both show as
// "No error text recorded". The first line of the error is the group key; a
// trailing carriage return from CRLF text is not part of the key.
const NO_ERROR = "tc.error IS NULL OR tc.error = ''";
const LINE = `CASE WHEN ${NO_ERROR} THEN NULL
  ELSE rtrim(substr(substr(tc.error, 1, instr(tc.error || char(10), char(10)) - 1), 1, ${FAILURE_LINE_CHARS}), char(13)) END`;

const CALL_FIELDS = `
  tc.position, tc.name,
  substr(tc.input, 1, ${FAILURE_INPUT_CAP}) AS input,
  length(tc.input) > ${FAILURE_INPUT_CAP} AS input_cut,
  CASE WHEN ${NO_ERROR} THEN NULL ELSE tc.error END AS error`;

/** True when a turn with this id exists. */
export async function turnExists(db: SkillsDb, turnId: number): Promise<boolean> {
  return Boolean(await db.get("SELECT id FROM turns WHERE id = ?", [turnId]));
}

/** `position`, `name`, `input`, `input_cut` and `error` of a turn's failed calls, in order. */
export function turnFailureRows(db: SkillsDb, turnId: number): Promise<Row[]> {
  return db.all(
    `SELECT ${CALL_FIELDS} FROM tool_calls tc
     WHERE tc.turn_id = ? AND tc.outcome = 'error' ORDER BY tc.position, tc.id`,
    [turnId]
  );
}

/** The failed calls that count against a skill, and the top groups of them. */
function failureQueries(skill: SkillName, entries: IndexEntries) {
  const uses = skillUsesFor(skill, entries);
  // The earliest use of this skill only, as the ranking measures it; another
  // skill used earlier in the same turn does not move the line.
  const firstUse = `SELECT u.turn_id, MIN(COALESCE(u.position, -1)) AS position
    FROM (${uses.sql}) u GROUP BY u.turn_id`;
  const failed = `SELECT tc.id, tc.turn_id, tc.position, tc.name, t.created_at, t.project_name, ${LINE} AS line,
      substr(tc.input, 1, ${FAILURE_INPUT_CAP}) AS input,
      length(tc.input) > ${FAILURE_INPUT_CAP} AS input_cut,
      CASE WHEN ${NO_ERROR} THEN NULL ELSE tc.error END AS error
    FROM tool_calls tc
    JOIN turns t ON t.id = tc.turn_id
    JOIN (${firstUse}) f ON f.turn_id = tc.turn_id
    WHERE tc.outcome = 'error' AND tc.position > f.position`;
  const top = `SELECT name, line, COUNT(*) AS calls, COUNT(DISTINCT turn_id) AS turn_count,
       MAX(created_at) AS last_seen
     FROM (${failed}) GROUP BY name, line
     ORDER BY calls DESC, last_seen DESC, name, line LIMIT ${FAILURE_GROUP_LIMIT}`;
  return { args: uses.args, failed, top };
}

/**
 * `name`, `line`, `calls`, `turn_count` and `last_seen` of a skill's failed
 * calls grouped by tool and first error line, most calls first, at most
 * `FAILURE_GROUP_LIMIT` groups.
 */
export function failureGroupRows(
  db: SkillsDb,
  skill: SkillName,
  entries: IndexEntries
): Promise<Row[]> {
  const query = failureQueries(skill, entries);
  return db.all(query.top, query.args);
}

/** The latest `FAILURE_SAMPLE` calls of each group `failureGroupRows` gives, newest first. */
export function latestFailureRows(
  db: SkillsDb,
  skill: SkillName,
  entries: IndexEntries
): Promise<Row[]> {
  const { args, failed, top } = failureQueries(skill, entries);
  // The latest calls of the returned groups in one query: window functions work in the
  // store's libSQL (checked for this change), so no JavaScript fallback is needed.
  return db.all(
    `SELECT turn_id, created_at, project_name, position, name, line, input, input_cut, error
     FROM (SELECT g.*, ROW_NUMBER() OVER (PARTITION BY g.name, g.line ORDER BY g.created_at DESC, g.id DESC) AS rn
       FROM (${failed}) g
       JOIN (${top}) k ON k.name = g.name AND k.line IS g.line)
     WHERE rn <= ${FAILURE_SAMPLE} ORDER BY name, line, rn`,
    [...args, ...args]
  );
}

// --- Agent evidence --------------------------------------------------------

/**
 * `id`, `host` and `failed` (a call failed after the skill loaded, the
 * ranking's rule) of the turns with the ids in `idsJson`.
 */
export function turnFactRows(db: SkillsDb, ref: SkillMatch, idsJson: string): Promise<Row[]> {
  return db.all(
    `SELECT t.id, t.host, EXISTS (
       SELECT 1 FROM tool_calls tc WHERE tc.turn_id = t.id AND tc.outcome = 'error'
         AND tc.position > (SELECT MIN(COALESCE(su.position, -1)) FROM skill_uses su
                            WHERE su.turn_id = t.id AND ${USES_WHERE})
     ) AS failed
     FROM turns t WHERE t.id IN (SELECT value FROM json_each(?))`,
    [...useArgs(ref), idsJson]
  );
}
