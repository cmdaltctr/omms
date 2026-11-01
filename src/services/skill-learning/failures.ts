import type { SkillIndex } from "./skill-index.js";
import { skillUsesFor } from "./turn-summaries.js";
import type { SkillStore } from "./store.js";

/** The server sends at most this many characters of one call's input (design §3). */
export const FAILURE_INPUT_CAP = 20_000;
/** A group key is the first line of the error text, cut to this length (design §4). */
export const FAILURE_LINE_CHARS = 200;
/** How many of a group's latest calls the reply carries. */
export const FAILURE_SAMPLE = 5;
/** How many groups the reply carries, most calls first. */
export const FAILURE_GROUP_LIMIT = 50;

/** One failed tool call of a turn, as the dialog shows it. */
export interface TurnFailure {
  position: number;
  name: string;
  input: string;
  /** True when the stored input was longer than `FAILURE_INPUT_CAP`. */
  inputCut: boolean;
  /** Null when the host reported no error text. */
  error: string | null;
}

/** One failed call of a group: the call fields plus its turn's time and project. */
export interface FailureGroupCall extends TurnFailure {
  turnId: number;
  createdAt: number;
  projectName: string | null;
}

/** The failed calls of one skill that count against it, grouped by tool and first error line. */
export interface FailureGroup {
  /** The tool name. */
  name: string;
  /** The first line of the error text, cut to `FAILURE_LINE_CHARS`; null when no error text. */
  errorLine: string | null;
  /** Calls in the group. */
  calls: number;
  /** Turns the calls span. */
  turns: number;
  /** When the newest call of the group happened. */
  lastSeenAt: number;
  /** The latest `FAILURE_SAMPLE` calls, newest first. */
  latest: FailureGroupCall[];
}

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

function callRow(row: Record<string, unknown>): TurnFailure {
  return {
    position: Number(row.position),
    name: String(row.name),
    input: String(row.input),
    inputCut: Number(row.input_cut) === 1,
    error: row.error == null ? null : String(row.error),
  };
}

/**
 * Every failed call of one turn, ordered by position. Null when the turn does
 * not exist; an empty list when it has no failed call. A missing `skills.db`
 * gives an empty list and stays missing.
 */
export async function turnFailures(
  store: SkillStore,
  turnId: number
): Promise<TurnFailure[] | null> {
  const db = await store.existingDb();
  if (!db) return [];
  const turn = await db.get("SELECT id FROM turns WHERE id = ?", [turnId]);
  if (!turn) return null;
  const rows = await db.all(
    `SELECT ${CALL_FIELDS} FROM tool_calls tc
     WHERE tc.turn_id = ? AND tc.outcome = 'error' ORDER BY tc.position, tc.id`,
    [turnId]
  );
  return rows.map(callRow);
}

/**
 * The failed calls of one skill that count against it by the ranking rule,
 * grouped by tool name and the first line of the error text, most calls first.
 * At most `FAILURE_GROUP_LIMIT` groups come back, each with its latest calls.
 * A missing `skills.db` gives an empty list and stays missing.
 */
export async function skillFailureGroups(
  store: SkillStore,
  skill: { name: string; path: string | null },
  index: SkillIndex
): Promise<FailureGroup[]> {
  const db = await store.existingDb();
  if (!db) return [];
  const uses = skillUsesFor(skill, index);
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
  const groups = await db.all(top, uses.args);
  if (groups.length === 0) return [];
  // The latest calls of the returned groups in one query: window functions work in the
  // store's libSQL (checked for this change), so no JavaScript fallback is needed.
  const latest = await db.all(
    `SELECT turn_id, created_at, project_name, position, name, line, input, input_cut, error
     FROM (SELECT g.*, ROW_NUMBER() OVER (PARTITION BY g.name, g.line ORDER BY g.created_at DESC, g.id DESC) AS rn
       FROM (${failed}) g
       JOIN (${top}) k ON k.name = g.name AND k.line IS g.line)
     WHERE rn <= ${FAILURE_SAMPLE} ORDER BY name, line, rn`,
    [...uses.args, ...uses.args]
  );
  const byGroup = new Map<string, FailureGroupCall[]>();
  for (const row of latest) {
    const key = JSON.stringify([String(row.name), row.line == null ? null : String(row.line)]);
    const list = byGroup.get(key) ?? [];
    list.push({
      ...callRow(row),
      turnId: Number(row.turn_id),
      createdAt: Number(row.created_at),
      projectName: row.project_name == null ? null : String(row.project_name),
    });
    byGroup.set(key, list);
  }
  return groups.map((group) => ({
    name: String(group.name),
    errorLine: group.line == null ? null : String(group.line),
    calls: Number(group.calls),
    turns: Number(group.turn_count),
    lastSeenAt: Number(group.last_seen),
    latest:
      byGroup.get(
        JSON.stringify([String(group.name), group.line == null ? null : String(group.line)])
      ) ?? [],
  }));
}
