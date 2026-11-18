import {
  failureGroupRows,
  latestFailureRows,
  turnExists,
  turnFailureRows,
} from "../storage/skills/turn-queries.js";
import type { SkillIndex } from "./skill-index.js";
import type { SkillStore } from "./store.js";

export {
  FAILURE_GROUP_LIMIT,
  FAILURE_INPUT_CAP,
  FAILURE_LINE_CHARS,
  FAILURE_SAMPLE,
} from "../storage/skills/turn-queries.js";

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
  if (!(await turnExists(db, turnId))) return null;
  const rows = await turnFailureRows(db, turnId);
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
  const groups = await failureGroupRows(db, skill, index.entries);
  if (groups.length === 0) return [];
  const latest = await latestFailureRows(db, skill, index.entries);
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
