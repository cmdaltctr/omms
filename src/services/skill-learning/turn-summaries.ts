import type { SkillIndex } from "./skill-index.js";
import type { SkillStore } from "./store.js";

/** The Skills page shows this much of a prompt. */
export const PROMPT_PREVIEW_CHARS = 200;
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

const COLUMNS = `t.id, t.created_at, t.host, t.project_name,
  substr(t.prompt, 1, ${PROMPT_PREVIEW_CHARS}) AS preview,
  (SELECT COUNT(*) FROM tool_calls tc WHERE tc.turn_id = t.id AND tc.outcome = 'error') AS failed`;

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

// The same use-to-skill rule as the ranking: a recorded path counts while the
// index lists it; a use with no path belongs to the one watched skill with its name.
const BY_PATH = `
SELECT ${COLUMNS} FROM turns t WHERE t.id IN (
  SELECT su.turn_id FROM skill_uses su
  WHERE su.skill_path = ? OR (su.skill_path IS NULL AND su.skill_name = ? AND ? = 1)
) ORDER BY t.created_at DESC, t.id DESC LIMIT ?`;

const BY_NAME = `
SELECT ${COLUMNS} FROM turns t WHERE t.id IN (
  SELECT su.turn_id FROM skill_uses su
  WHERE su.skill_name = ? AND (
    (su.skill_path IS NOT NULL AND su.skill_path NOT IN (SELECT value FROM json_each(?)))
    OR (su.skill_path IS NULL AND ? = 0)
  )
) ORDER BY t.created_at DESC, t.id DESC LIMIT ?`;

/**
 * The newest turns that used one skill. `path` is null for a skill that no
 * watched folder holds. A missing `skills.db` gives no turns and stays missing.
 */
export async function recentSkillTurns(
  store: SkillStore,
  skill: { name: string; path: string | null },
  index: SkillIndex,
  limit = RECENT_TURN_LIMIT
): Promise<SkillTurnSummary[]> {
  const db = await store.existingDb();
  if (!db) return [];
  const named = index.entries.filter((e) => e.name === skill.name);
  const rows = skill.path
    ? await db.all(BY_PATH, [
        skill.path,
        skill.name,
        named.length === 1 && named[0]!.path === skill.path ? 1 : 0,
        limit,
      ])
    : await db.all(BY_NAME, [
        skill.name,
        JSON.stringify(index.entries.map((e) => e.path)),
        named.length === 1 ? 1 : 0,
        limit,
      ]);
  return rows.map(toSummary);
}

/** The turns with these ids, newest first; ids of deleted turns are left out. */
export async function skillTurnsByIds(
  store: SkillStore,
  ids: readonly number[]
): Promise<SkillTurnSummary[]> {
  const db = await store.existingDb();
  if (!db || ids.length === 0) return [];
  const rows = await db.all(
    `SELECT ${COLUMNS} FROM turns t WHERE t.id IN (SELECT value FROM json_each(?))
     ORDER BY t.created_at DESC, t.id DESC`,
    [JSON.stringify(ids)]
  );
  return rows.map(toSummary);
}
