import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashSkillContent, SKILL_FILE_NAME } from "./apply.js";
import {
  countSkillUses,
  MAX_TOTAL_TURN_CHARS,
  MAX_TURN_CHARS,
  recentSkillTurns,
  skillRef,
  turnsById,
  USES_WHERE,
  useArgs,
  type DraftTurn,
  type SkillRef,
} from "./draft-turns.js";
import {
  NO_CHANGE_PROPOSED,
  READ_ONLY,
  SKILL_NAME,
  sameText,
  withFinalNewline,
} from "./drafting.js";
import { lineDiff } from "./line-diff.js";
import { createProposal, setSkillReview, type SkillProposal } from "./proposal-store.js";
import { readFrontMatter, type SkillIndex } from "./skill-index.js";
import type { SkillStore } from "./store.js";

/**
 * The agent path (design §8): the coding agent reads a skill's evidence and
 * proposes a revised file itself. No model call. The proposal is pending, and
 * apply still waits for the user's request.
 */

export const DEFAULT_EVIDENCE_TURNS = 10;
export const MAX_EVIDENCE_TURNS = 20;
export const MAX_PROPOSED_BYTES = 100 * 1024;

export interface AgentDeps {
  store: SkillStore;
  index: SkillIndex;
  now: number;
}

export interface EvidenceTurn {
  id: number;
  createdAt: number;
  host: string;
  prompt: string;
  replies: string[];
  tools: Array<{ name: string; outcome: string; error: string | null }>;
  /** A tool call failed after the skill loaded in this turn. */
  failedAfterUse: boolean;
  /** Text was cut to keep the turn within 4,000 characters, or the total within 60,000. */
  cut: boolean;
}

export type AgentFailure = { ok: false; code: string; message: string };

export type EvidenceResult =
  { ok: true; ref: SkillRef; content: string; turns: EvidenceTurn[] } | AgentFailure;

export type ProposeResult =
  | { ok: true; code: "proposed"; proposal: SkillProposal }
  | { ok: true; code: "no-change"; message: typeof NO_CHANGE_PROPOSED }
  | AgentFailure;

function readSkill(path: string, index: SkillIndex) {
  const ref = skillRef(index, path);
  if (!ref)
    return { ok: false, code: "not-found", message: `${path} is not a watched skill` } as const;
  try {
    const raw = readFileSync(path);
    return { ok: true, ref, raw, current: raw.toString("utf8") } as const;
  } catch {
    return { ok: false, code: "not-found", message: `${path} cannot be read` } as const;
  }
}

/** Turn ids and hosts, with whether a call failed after the skill loaded (ranking's rule). */
async function turnFacts(store: SkillStore, ref: SkillRef, ids: number[]) {
  const db = await store.db();
  const rows = await db.all(
    `SELECT t.id, t.host, EXISTS (
       SELECT 1 FROM tool_calls tc WHERE tc.turn_id = t.id AND tc.outcome = 'error'
         AND tc.position > (SELECT MIN(COALESCE(su.position, -1)) FROM skill_uses su
                            WHERE su.turn_id = t.id AND ${USES_WHERE})
     ) AS failed
     FROM turns t WHERE t.id IN (SELECT value FROM json_each(?))`,
    [...useArgs(ref), JSON.stringify(ids)]
  );
  return new Map(
    rows.map((row) => [
      Number(row.id),
      { host: String(row.host), failed: Number(row.failed) === 1 },
    ])
  );
}

/** One turn cut to `allowance` characters: prompt, then tool errors, then replies. */
function budgetTurn(turn: DraftTurn, allowance: number) {
  let left = allowance;
  let cut = false;
  const take = (text: string) => {
    const kept = text.slice(0, Math.max(0, left));
    if (kept.length < text.length) cut = true;
    left -= kept.length;
    return kept;
  };
  const prompt = take(turn.prompt);
  const tools = turn.tools.map((t) => ({ ...t, error: t.error === null ? null : take(t.error) }));
  const replies = turn.replies.map(take).filter((reply) => reply !== "");
  return { prompt, tools, replies, cut, used: allowance - left };
}

/**
 * The skill's current file and its newest recorded turns, at most `limit`.
 * Turns with a failed call after the skill loaded come first. The text is as
 * stored, which is redacted when redaction is on, within the drafting budget.
 */
export async function skillEvidence(
  path: string,
  limit: number,
  deps: AgentDeps
): Promise<EvidenceResult> {
  const skill = readSkill(path, deps.index);
  if (!skill.ok) return skill;
  const db = await deps.store.existingDb();
  const recent = db ? await recentSkillTurns(db, skill.ref, limit) : [];
  const facts =
    recent.length > 0
      ? await turnFacts(
          deps.store,
          skill.ref,
          recent.map((t) => t.id)
        )
      : new Map();
  const failedFirst = [
    ...recent.filter((t) => facts.get(t.id)?.failed),
    ...recent.filter((t) => !facts.get(t.id)?.failed),
  ];
  const turns: EvidenceTurn[] = [];
  let left = MAX_TOTAL_TURN_CHARS;
  for (const turn of failedFirst) {
    if (left <= 0) break;
    const { used, ...kept } = budgetTurn(turn, Math.min(MAX_TURN_CHARS, left));
    left -= used;
    const fact = facts.get(turn.id);
    turns.push({
      id: turn.id,
      createdAt: turn.createdAt,
      host: fact?.host ?? "",
      ...kept,
      failedAfterUse: fact?.failed ?? false,
    });
  }
  return { ok: true, ref: skill.ref, content: skill.current, turns };
}

export interface ProposalInput {
  content: string;
  summary: string;
  evidenceTurnIds: number[];
}

function tooLarge(content: string): AgentFailure | null {
  if (Buffer.byteLength(content, "utf8") <= MAX_PROPOSED_BYTES) return null;
  return { ok: false, code: "too-large", message: "content is over 100 KB" };
}

/** The given ids that name a recorded turn. */
async function existingTurnIds(store: SkillStore, ids: number[]): Promise<number[]> {
  const db = await store.existingDb();
  if (!db || ids.length === 0) return [];
  const found = new Set((await turnsById(db, ids)).map((turn) => turn.id));
  return ids.filter((id, i) => found.has(id) && ids.indexOf(id) === i);
}

/**
 * Saves the agent's revised `SKILL.md` as a pending `improve` proposal. The
 * base hash and the diff come from the file on disk. The same content gives
 * `no-change` and counts as a review, as a model draft does.
 */
export async function proposeImprovement(
  path: string,
  input: ProposalInput,
  deps: AgentDeps
): Promise<ProposeResult> {
  if (deps.store.isReadOnly()) return READ_ONLY;
  const large = tooLarge(input.content);
  if (large) return large;
  const skill = readSkill(path, deps.index);
  if (!skill.ok) return skill;
  const content = withFinalNewline(input.content);
  if (sameText(content, skill.current)) {
    const db = await deps.store.existingDb();
    const uses = db ? await countSkillUses(db, skill.ref) : 0;
    await setSkillReview(deps.store, path, deps.now, uses);
    return { ok: true, code: "no-change", message: NO_CHANGE_PROPOSED };
  }
  const proposal = await createProposal(
    deps.store,
    {
      kind: "improve",
      skillName: skill.ref.name,
      skillPath: path,
      baseHash: hashSkillContent(skill.raw),
      content,
      diff: lineDiff(skill.current, content),
      summary: input.summary.trim(),
      evidenceTurnIds: await existingTurnIds(deps.store, input.evidenceTurnIds),
      draftedBy: "agent",
    },
    deps.now
  );
  return { ok: true, code: "proposed", proposal };
}

/**
 * Saves the agent's new `SKILL.md` as a pending `new` proposal at
 * `<folder>/<name>/SKILL.md`, with the checks `draftNewSkill` makes.
 */
export async function proposeNewSkill(
  name: string,
  folder: string,
  input: ProposalInput,
  deps: AgentDeps
): Promise<ProposeResult> {
  if (deps.store.isReadOnly()) return READ_ONLY;
  if (!SKILL_NAME.test(name)) {
    return {
      ok: false,
      code: "invalid-name",
      message: "A new skill name may hold only lower-case letters, digits and single hyphens",
    };
  }
  const large = tooLarge(input.content);
  if (large) return large;
  const content = withFinalNewline(input.content);
  const front = readFrontMatter(content);
  if (front.name !== name || !front.description?.trim()) {
    return {
      ok: false,
      code: "invalid-content",
      message: `The front matter needs name: ${name} and a description`,
    };
  }
  const proposal = await createProposal(
    deps.store,
    {
      kind: "new",
      skillName: name,
      skillPath: join(folder, name, SKILL_FILE_NAME),
      baseHash: null,
      content,
      diff: lineDiff("", content),
      summary: input.summary.trim(),
      evidenceTurnIds: await existingTurnIds(deps.store, input.evidenceTurnIds),
      draftedBy: "agent",
    },
    deps.now
  );
  return { ok: true, code: "proposed", proposal };
}
