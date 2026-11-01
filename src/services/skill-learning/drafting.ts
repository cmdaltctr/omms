import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  recordProfileFailure,
  skillDraftBackoff,
  type Backoff,
} from "../../core/profile-backoff.js";
import {
  ProfileModelError,
  profileFailureCode,
  profileResultCode,
  type ProfileFailureCode,
} from "../../core/profile-failure.js";
import type { ToolCallResult } from "../ai/providers/base-provider.js";
import { hashSkillContent, SKILL_FILE_NAME } from "./apply.js";
import {
  compactTurnText,
  countSkillUses,
  fullTurnText,
  packTurns,
  pickEvidence,
  recentSkillTurns,
  recentTurns,
  skillRef,
  turnsById,
} from "./draft-turns.js";
import { lineDiff } from "./line-diff.js";
import { createProposal, setSkillReview, type SkillProposal } from "./proposal-store.js";
import { readFrontMatter, type SkillIndex } from "./skill-index.js";
import type { SkillStore } from "./store.js";

export {
  MAX_DRAFT_TURNS,
  MAX_IDEA_TURNS,
  MAX_TOTAL_TURN_CHARS,
  MAX_TURN_CHARS,
} from "./draft-turns.js";

export const NO_CHANGE_PROPOSED = "No change proposed";
export const MAX_SKILL_IDEAS = 3;
export const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The external API model, as the chat uses it (ADR-033). */
export interface SkillModel {
  /** False when the external API is not fully set up. No call is made then. */
  ready: boolean;
  /** One structured call. Throws or returns `success: false` on failure. */
  callTool(system: string, user: string, tool: object): Promise<ToolCallResult>;
}

export interface DraftDeps {
  /** An initialised store. */
  store: SkillStore;
  /** The current watched skills. */
  index: SkillIndex;
  model: SkillModel;
  now?: () => number;
  /** The wait a failure starts. Defaults to `skillDraftBackoff`. */
  backoff?: Backoff;
}

export type DraftFailureCode = ProfileFailureCode | "not-found" | "invalid-name" | "read-only";

export type DraftFailure = { ok: false; code: DraftFailureCode; message: string };

export type DraftResult =
  | { ok: true; code: "proposed"; proposal: SkillProposal }
  | { ok: true; code: "no-change"; message: typeof NO_CHANGE_PROPOSED }
  | DraftFailure;

export interface SkillIdea {
  name: string;
  description: string;
  reason: string;
  evidenceTurnIds: number[];
}

export type IdeasResult = { ok: true; ideas: SkillIdea[] } | DraftFailure;

const labels = z.array(z.union([z.string(), z.number()]).transform(String));

const DraftReply = z.object({
  content: z.string().min(1),
  summary: z.string(),
  evidence: labels.default([]),
});

const IdeasReply = z.object({
  ideas: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      reason: z.string(),
      evidence: labels.default([]),
    })
  ),
});

const NewSkillReply = z.object({ content: z.string().min(1), summary: z.string() });

function tool(name: string, description: string, properties: Record<string, unknown>) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required: Object.keys(properties) },
    },
  };
}
export { tool };

const evidenceField = {
  type: "array",
  items: { type: "string" },
  description: "Labels such as T12 of the given turns that support the answer",
};

const DRAFT_TOOL = tool("propose_skill_update", "Return the revised SKILL.md", {
  content: { type: "string", description: "The full revised SKILL.md, front matter included" },
  summary: { type: "string", description: "One or two sentences on what changed and why" },
  evidence: evidenceField,
});

const IDEAS_TOOL = tool("suggest_skills", "Return new skill ideas", {
  ideas: {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string", description: "Kebab-case name, such as release-notes" },
        description: { type: "string", description: "One line: when an agent should use it" },
        reason: { type: "string", description: "What in the turns shows the need" },
        evidence: evidenceField,
      },
      required: ["name", "description", "reason", "evidence"],
    },
  },
});

const NEW_SKILL_TOOL = tool("write_skill", "Return the new SKILL.md", {
  content: { type: "string", description: "The full SKILL.md, front matter included" },
  summary: { type: "string", description: "One sentence on what the skill does" },
});

const DRAFT_SYSTEM = [
  "You improve one agent skill file (SKILL.md) from recorded turns in which a coding agent used it.",
  "Look for where the agent struggled: failed tool calls, repeated attempts, user corrections and missing steps.",
  "Change the file only where the turns show a gap or an error. Keep the front matter, the skill name and every part that still works.",
  "When the turns show no gap, return the current file unchanged.",
  "List as evidence only labels of the turns given. Write plain British English. Call the propose_skill_update tool.",
].join(" ");

const IDEAS_SYSTEM = [
  "You find repeated workflows in recorded coding agent turns that no listed skill covers.",
  `Suggest at most ${MAX_SKILL_IDEAS} new skills. Give each a kebab-case name that differs from every listed skill.`,
  "Suggest a skill only when several turns show the same kind of task. Return an empty list when none does.",
  "List as evidence only labels of the turns given. Write plain British English. Call the suggest_skills tool.",
].join(" ");

const NEW_SKILL_SYSTEM = [
  "You write a new agent skill file (SKILL.md) for a coding agent.",
  "Start with YAML front matter between --- lines that holds `name` set to the given name and a one-line `description` of when to use the skill.",
  "Then give short, ordered instructions. Use only what the idea and the turns support.",
  "Write plain British English. Call the write_skill tool.",
].join(" ");

function nowOf(deps: DraftDeps): number {
  return (deps.now ?? Date.now)();
}

const FAILURE_TEXT: Partial<Record<DraftFailureCode, string>> = {
  "not-configured": "The external API is not set up. Set it up in the External API card.",
  // One reply in two came back as broken JSON in a live check, so a retry usually works.
  "invalid-reply": "The model reply was not valid, so nothing was saved. Try again.",
  timeout: "The model did not reply in time",
};

/** Log one metadata record, start the skill draft wait and return the failure. */
function fail(deps: DraftDeps, step: string, code: ProfileFailureCode): DraftFailure {
  recordProfileFailure(
    null,
    `Skill ${step} failed`,
    new ProfileModelError(code),
    nowOf(deps),
    deps.backoff ?? skillDraftBackoff
  );
  return { ok: false, code, message: FAILURE_TEXT[code] ?? `Drafting failed: ${code}` };
}

/** One model call with its reply checked by `schema`. Failures are logged by code only. */
async function ask<T>(
  deps: DraftDeps,
  step: string,
  prompt: { system: string; user: string; tool: object },
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | DraftFailure> {
  if (!deps.model.ready) return fail(deps, step, "not-configured");
  let result: ToolCallResult;
  try {
    result = await deps.model.callTool(prompt.system, prompt.user, prompt.tool);
  } catch (error) {
    return fail(deps, step, profileFailureCode(error));
  }
  if (!result.success) return fail(deps, step, profileResultCode(result));
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) return fail(deps, step, "invalid-reply");
  (deps.backoff ?? skillDraftBackoff).recordSuccess();
  return { ok: true, data: parsed.data };
}

export function withFinalNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function sameText(a: string, b: string): boolean {
  return a.replace(/\n+$/, "") === b.replace(/\n+$/, "");
}

export const READ_ONLY: DraftFailure = {
  ok: false,
  code: "read-only",
  message: "skills.db is from a newer OMMS and is read-only",
};

/**
 * Asks the model to improve one watched skill from its newest recorded uses
 * (design §6). Saves a pending `improve` proposal, or nothing when the reply
 * is invalid or leaves the file as it is.
 */
export async function draftImprovement(skillPath: string, deps: DraftDeps): Promise<DraftResult> {
  if (deps.store.isReadOnly()) return READ_ONLY;
  const ref = skillRef(deps.index, skillPath);
  if (!ref) return { ok: false, code: "not-found", message: `${skillPath} is not a watched skill` };
  let raw: Buffer;
  try {
    raw = readFileSync(skillPath);
  } catch {
    return { ok: false, code: "not-found", message: `${skillPath} cannot be read` };
  }
  const current = raw.toString("utf8");
  const db = await deps.store.existingDb();
  const packed = packTurns(db ? await recentSkillTurns(db, ref) : [], fullTurnText);
  const user = [
    `Skill: ${ref.name}`,
    `Current SKILL.md:\n<<<\n${current}\n>>>`,
    `Recorded turns, newest first:`,
    packed.text || "(none)",
  ].join("\n\n");
  const reply = await ask(
    deps,
    "draft",
    { system: DRAFT_SYSTEM, user, tool: DRAFT_TOOL },
    DraftReply
  );
  if (!reply.ok) return reply;
  const content = withFinalNewline(reply.data.content);
  if (sameText(content, current)) {
    // A draft with no change counts as a review, so ranking stops marking the skill Suggested.
    const uses = db ? await countSkillUses(db, ref) : 0;
    await setSkillReview(deps.store, skillPath, nowOf(deps), uses);
    return { ok: true, code: "no-change", message: NO_CHANGE_PROPOSED };
  }
  const proposal = await createProposal(
    deps.store,
    {
      kind: "improve",
      skillName: ref.name,
      skillPath,
      baseHash: hashSkillContent(raw),
      content,
      diff: lineDiff(current, content),
      summary: reply.data.summary.trim(),
      evidenceTurnIds: pickEvidence(reply.data.evidence, packed.sentIds),
    },
    nowOf(deps)
  );
  return { ok: true, code: "proposed", proposal };
}

/**
 * Asks the model for new skill ideas from up to 200 compact recent turns.
 * Keeps at most three valid kebab-case names that no watched skill uses.
 * Ideas are returned, not saved.
 */
export async function findSkillIdeas(deps: DraftDeps): Promise<IdeasResult> {
  const db = await deps.store.existingDb();
  const turns = db ? await recentTurns(db) : [];
  if (deps.model.ready && turns.length === 0) return { ok: true, ideas: [] };
  const packed = packTurns(turns, compactTurnText);
  const watched = deps.index.entries.map((e) => `- ${e.name}: ${e.description}`);
  const user = [
    `Watched skills:\n${watched.join("\n") || "(none)"}`,
    `Recorded turns, newest first:`,
    packed.text,
  ].join("\n\n");
  const reply = await ask(
    deps,
    "ideas",
    { system: IDEAS_SYSTEM, user, tool: IDEAS_TOOL },
    IdeasReply
  );
  if (!reply.ok) return reply;
  const taken = new Set(deps.index.entries.map((e) => e.name.toLowerCase()));
  const ideas: SkillIdea[] = [];
  for (const idea of reply.data.ideas) {
    const name = idea.name.trim();
    if (!SKILL_NAME.test(name) || taken.has(name) || !idea.description.trim()) continue;
    taken.add(name);
    ideas.push({
      name,
      description: idea.description.trim(),
      reason: idea.reason.trim(),
      evidenceTurnIds: pickEvidence(idea.evidence, packed.sentIds),
    });
    if (ideas.length === MAX_SKILL_IDEAS) break;
  }
  return { ok: true, ideas };
}

/**
 * Asks the model for a full `SKILL.md` for one idea and saves it as a pending
 * `new` proposal at `<folder>/<name>/SKILL.md`. The front matter must name
 * the idea and hold a description.
 */
export async function draftNewSkill(
  idea: SkillIdea,
  folder: string,
  deps: DraftDeps
): Promise<DraftResult> {
  if (deps.store.isReadOnly()) return READ_ONLY;
  if (!SKILL_NAME.test(idea.name)) {
    return {
      ok: false,
      code: "invalid-name",
      message: "A new skill name may hold only lower-case letters, digits and single hyphens",
    };
  }
  const db = await deps.store.existingDb();
  const evidence =
    db && idea.evidenceTurnIds.length > 0 ? await turnsById(db, idea.evidenceTurnIds) : [];
  const packed = packTurns(evidence, fullTurnText);
  const user = [
    `Name: ${idea.name}`,
    `Description: ${idea.description}`,
    `Reason: ${idea.reason}`,
    `Recorded turns, newest first:`,
    packed.text || "(none)",
  ].join("\n\n");
  const prompt = { system: NEW_SKILL_SYSTEM, user, tool: NEW_SKILL_TOOL };
  const reply = await ask(deps, "new skill draft", prompt, NewSkillReply);
  if (!reply.ok) return reply;
  const content = withFinalNewline(reply.data.content);
  const front = readFrontMatter(content);
  if (front.name !== idea.name || !front.description?.trim()) {
    return fail(deps, "new skill draft", "invalid-reply");
  }
  const proposal = await createProposal(
    deps.store,
    {
      kind: "new",
      skillName: idea.name,
      skillPath: join(folder, idea.name, SKILL_FILE_NAME),
      baseHash: null,
      content,
      diff: lineDiff("", content),
      summary: reply.data.summary.trim(),
      evidenceTurnIds: pickEvidence(idea.evidenceTurnIds.map(String), packed.sentIds),
    },
    nowOf(deps)
  );
  return { ok: true, code: "proposed", proposal };
}
