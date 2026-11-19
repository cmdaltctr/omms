import {
  skillTurnCount,
  skillTurnSummaryRows,
  turnSummaryRowsByIds,
} from "../storage/skills/turn-queries.js";
import type { SkillIndex } from "./skill-index.js";
import type { SkillStore } from "../storage/skills/store.js";

export { PROMPT_PREVIEW_CHARS } from "../storage/skills/turn-queries.js";
export const RECENT_TURN_LIMIT = 20;

/** One recorded turn as the Skills page lists it: no replies, no tool input. */
export interface SkillTurnSummary {
  id: number;
  createdAt: number;
  host: string;
  projectName: string | null;
  promptPreview: string;
  failedToolCalls: number;
}

function toSummary(row: Record<string, unknown>): SkillTurnSummary {
  return {
    id: Number(row.id),
    createdAt: Number(row.created_at),
    host: String(row.host),
    projectName: row.project_name == null ? null : String(row.project_name),
    promptPreview: String(row.preview),
    failedToolCalls: Number(row.failed),
  };
}

/**
 * Turns that used one skill, newest first, `limit` of them after skipping
 * `offset`. `path` is null for a skill that no watched folder holds. A missing
 * `skills.db` gives no turns and stays missing.
 */
export async function recentSkillTurns(
  store: SkillStore,
  skill: { name: string; path: string | null },
  index: SkillIndex,
  limit = RECENT_TURN_LIMIT,
  offset = 0
): Promise<SkillTurnSummary[]> {
  const db = await store.existingDb();
  if (!db) return [];
  const rows = await skillTurnSummaryRows(db, skill, index.entries, limit, offset);
  return rows.map(toSummary);
}

/** How many recorded turns used this skill. */
export async function countSkillTurns(
  store: SkillStore,
  skill: { name: string; path: string | null },
  index: SkillIndex
): Promise<number> {
  const db = await store.existingDb();
  if (!db) return 0;
  return skillTurnCount(db, skill, index.entries);
}

/** The turns with these ids, newest first; ids of deleted turns are left out. */
export async function skillTurnsByIds(
  store: SkillStore,
  ids: readonly number[]
): Promise<SkillTurnSummary[]> {
  const db = await store.existingDb();
  if (!db || ids.length === 0) return [];
  const rows = await turnSummaryRowsByIds(db, JSON.stringify(ids));
  return rows.map(toSummary);
}
