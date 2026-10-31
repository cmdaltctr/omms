import type { TursoDb } from "../turso/turso-db.js";
import type { SkillIndex } from "./skill-index.js";

/** Design §6: the budgets for turn text sent to the external API model. */
export const MAX_DRAFT_TURNS = 20;
export const MAX_IDEA_TURNS = 200;
export const MAX_TURN_CHARS = 4_000;
export const MAX_TOTAL_TURN_CHARS = 60_000;
/** An idea turn shows only the start of its prompt. */
export const IDEA_PROMPT_CHARS = 300;

/** A watched skill and the rule that matches its recorded uses. */
export interface SkillRef {
  name: string;
  path: string;
  /**
   * True when exactly one watched skill has this name, so a use recorded
   * without a path counts for it. Ranking uses the same rule.
   */
  byName: boolean;
}

export interface DraftTurn {
  id: number;
  createdAt: number;
  prompt: string;
  replies: string[];
  tools: Array<{ name: string; outcome: string; error: string | null }>;
}

/** The watched skill at `path`, or null when no watched folder holds it. */
export function skillRef(index: SkillIndex, path: string): SkillRef | null {
  const entry = index.entries.find((e) => e.path === path);
  if (!entry) return null;
  const sameName = index.entries.filter((e) => e.name === entry.name).length;
  return { name: entry.name, path, byName: sameName === 1 };
}

/** The `skill_uses` rows (alias `su`) that count for a skill; bind `useArgs(ref)`. */
export const USES_WHERE =
  "(su.skill_path = ? OR (su.skill_path IS NULL AND su.skill_name = ? AND ? = 1))";

export function useArgs(ref: SkillRef): Array<string | number> {
  return [ref.path, ref.name, ref.byName ? 1 : 0];
}

/** Recorded turns that used the skill, all time. A turn counts once. */
export async function countSkillUses(db: TursoDb, ref: SkillRef): Promise<number> {
  const row = await db.get(
    `SELECT COUNT(DISTINCT su.turn_id) AS n FROM skill_uses su WHERE ${USES_WHERE}`,
    useArgs(ref)
  );
  return Number(row?.n ?? 0);
}

function parseReplies(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function loadTurns(
  db: TursoDb,
  where: string,
  args: Array<string | number>
): Promise<DraftTurn[]> {
  const rows = await db.all(
    `SELECT t.id, t.created_at, t.prompt, t.replies_json FROM turns t
     WHERE ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
    args
  );
  if (rows.length === 0) return [];
  const turns = rows.map((row): DraftTurn => ({
    id: Number(row.id),
    createdAt: Number(row.created_at),
    prompt: String(row.prompt),
    replies: parseReplies(row.replies_json),
    tools: [],
  }));
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const calls = await db.all(
    `SELECT turn_id, name, outcome, error FROM tool_calls
     WHERE turn_id IN (SELECT value FROM json_each(?)) ORDER BY turn_id, position`,
    [JSON.stringify([...byId.keys()])]
  );
  for (const call of calls) {
    byId.get(Number(call.turn_id))?.tools.push({
      name: String(call.name),
      outcome: String(call.outcome),
      error: call.error == null ? null : String(call.error),
    });
  }
  return turns;
}

/** The newest turns that used the skill, newest first. */
export function recentSkillTurns(
  db: TursoDb,
  ref: SkillRef,
  limit = MAX_DRAFT_TURNS
): Promise<DraftTurn[]> {
  return loadTurns(db, `t.id IN (SELECT su.turn_id FROM skill_uses su WHERE ${USES_WHERE})`, [
    ...useArgs(ref),
    limit,
  ]);
}

/** The newest recorded turns of any kind, newest first. */
export function recentTurns(db: TursoDb, limit = MAX_IDEA_TURNS): Promise<DraftTurn[]> {
  return loadTurns(db, "1 = 1", [limit]);
}

/** The given turns that still exist, newest first. */
export function turnsById(db: TursoDb, ids: readonly number[]): Promise<DraftTurn[]> {
  return loadTurns(db, "t.id IN (SELECT value FROM json_each(?))", [
    JSON.stringify(ids),
    MAX_DRAFT_TURNS,
  ]);
}

/** The label the model sees and returns as evidence. */
export function turnLabel(id: number): string {
  return `T${id}`;
}

function toolLine(tool: DraftTurn["tools"][number]): string {
  return `- ${tool.name}: ${tool.outcome}${tool.error ? ` (${tool.error})` : ""}`;
}

/** A turn for an improvement draft. Tool outcomes come before replies, so a cut keeps them. */
export function fullTurnText(turn: DraftTurn): string {
  const parts = [
    `[${turnLabel(turn.id)}] ${new Date(turn.createdAt).toISOString()}`,
    `Prompt: ${turn.prompt}`,
  ];
  if (turn.tools.length > 0) parts.push("Tool calls:", ...turn.tools.map(toolLine));
  parts.push(...turn.replies.map((reply, i) => `Reply ${i + 1}: ${reply}`));
  return parts.join("\n");
}

/** A one-line turn for new skill ideas: the start of the prompt and the tool outcomes. */
export function compactTurnText(turn: DraftTurn): string {
  const prompt = turn.prompt.replace(/\s+/g, " ").trim().slice(0, IDEA_PROMPT_CHARS);
  const tools = turn.tools.map((tool) => `${tool.name} ${tool.outcome}`).join(", ");
  return `[${turnLabel(turn.id)}] ${prompt}${tools ? ` | tools: ${tools}` : ""}`;
}

/**
 * Turn blocks in the given order, each cut to `MAX_TURN_CHARS`, until the
 * total reaches `MAX_TOTAL_TURN_CHARS`. Returns the ids actually sent, so
 * evidence can name only those.
 */
export function packTurns(
  turns: readonly DraftTurn[],
  format: (turn: DraftTurn) => string
): { text: string; sentIds: number[] } {
  const blocks: string[] = [];
  const sentIds: number[] = [];
  let left = MAX_TOTAL_TURN_CHARS;
  for (const turn of turns) {
    if (left <= 0) break;
    const block = format(turn).slice(0, Math.min(MAX_TURN_CHARS, left));
    blocks.push(block);
    sentIds.push(turn.id);
    left -= block.length;
  }
  return { text: blocks.join("\n\n"), sentIds };
}

/** Evidence labels from a reply, kept only when they name a turn that was sent. */
export function pickEvidence(labels: readonly string[], sentIds: readonly number[]): number[] {
  const sent = new Set(sentIds);
  const picked: number[] = [];
  for (const label of labels) {
    const match = /^\s*T?(\d+)\s*$/i.exec(label);
    const id = match ? Number(match[1]) : NaN;
    if (sent.has(id) && !picked.includes(id)) picked.push(id);
  }
  return picked;
}
