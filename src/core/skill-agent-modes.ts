import {
  DEFAULT_EVIDENCE_TURNS,
  MAX_EVIDENCE_TURNS,
  proposeImprovement,
  proposeNewSkill,
  skillEvidence,
  type EvidenceTurn,
  type ProposeResult,
} from "../services/skill-learning/agent-proposals.js";
import { undoProposal } from "../services/skill-learning/apply.js";
import { getProposal } from "../services/skill-learning/proposal-store.js";
import { rankSkills } from "../services/skill-learning/ranking.js";
import { getSkillIndex } from "../services/skill-learning/skill-index.js";
import { reply, resolveSkillPath, watchedTarget } from "./skill-operation-reply.js";
import type {
  SkillOperationArgs,
  SkillOperationResult,
  SkillOperationsDeps,
} from "./skill-operations.js";

/**
 * The agent fixes a skill without the external API (design §8): `evidence`
 * gives the file and its turns, `propose` saves the agent's revised file as a
 * pending proposal, and `undo` reverts an applied one. No mode calls a model.
 */

const NEXT_STEP =
  "Write the fixed SKILL.md, then call propose with skill, content and summary. Show the user the diff. Call apply only when the user asks.";

function isReply(value: object): value is SkillOperationResult {
  return "code" in value;
}

function parseLimit(value: unknown): number | null {
  if (value === undefined || value === "") return DEFAULT_EVIDENCE_TURNS;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_EVIDENCE_TURNS ? limit : null;
}

/** Turn ids from numbers, `T12` labels, or a comma-separated list. */
function parseTurnIds(value: SkillOperationArgs["evidence"]): number[] {
  const items = typeof value === "string" ? value.split(",") : (value ?? []);
  const ids: number[] = [];
  for (const item of items) {
    const match = /^\s*T?(\d+)\s*$/i.exec(String(item));
    if (match) ids.push(Number(match[1]));
  }
  return ids;
}

function turnText(turn: EvidenceTurn): string {
  const parts = [`[T${turn.id}] ${new Date(turn.createdAt).toISOString()} ${turn.host}`];
  if (turn.failedAfterUse) parts.push("A tool call failed after the skill loaded.");
  parts.push(`Prompt: ${turn.prompt}`);
  if (turn.tools.length > 0) {
    parts.push("Tool calls:");
    for (const t of turn.tools) {
      parts.push(`- ${t.name}: ${t.outcome}${t.error ? ` (${t.error})` : ""}`);
    }
  }
  parts.push(...turn.replies.map((r, i) => `Reply ${i + 1}: ${r}`));
  if (turn.cut) parts.push("(cut)");
  return parts.join("\n");
}

export async function evidence(
  args: SkillOperationArgs,
  deps: SkillOperationsDeps,
  now: number
): Promise<SkillOperationResult> {
  const skill = args.skill?.trim();
  if (!skill) return reply("evidence", false, "invalid-args", "Give skill: a name or a path.");
  const limit = parseLimit(args.limit);
  if (limit === null) {
    return reply("evidence", false, "invalid-args", `limit must be 1 to ${MAX_EVIDENCE_TURNS}.`);
  }
  const index = getSkillIndex(deps.folders, now);
  const found = resolveSkillPath("evidence", skill, index);
  if (isReply(found)) return found;
  const result = await skillEvidence(found.path, limit, { store: deps.store, index, now });
  if (!result.ok) return reply("evidence", false, result.code, result.message);
  const ranked = (await rankSkills(deps.store, index, now)).find((r) => r.path === found.path);
  const numbers = {
    uses: ranked?.uses ?? 0,
    failedTurns: ranked?.failedTurns ?? 0,
    attention: ranked?.attention ?? 0,
  };
  const text = [
    `Skill: ${result.ref.name}`,
    `File: ${found.path}`,
    `Last 30 days: ${numbers.uses} uses, ${numbers.failedTurns} failed turns, attention ${numbers.attention.toFixed(2)}`,
    `Current SKILL.md:\n<<<\n${result.content}\n>>>`,
    "Recorded turns, failed first:",
    result.turns.map(turnText).join("\n\n") || "(none)",
    NEXT_STEP,
  ].join("\n\n");
  return reply("evidence", true, "ok", text, {
    name: result.ref.name,
    path: found.path,
    content: result.content,
    ...numbers,
    turns: result.turns,
  });
}

function proposeReply(result: ProposeResult): SkillOperationResult {
  if (!result.ok) return reply("propose", false, result.code, result.message);
  if (result.code === "no-change") return reply("propose", true, "no-change", result.message);
  const p = result.proposal;
  return reply(
    "propose",
    true,
    "proposed",
    `Saved pending proposal ${p.id} for ${p.skillName}. Show the user the diff below. Call apply only when the user asks.\n\n${p.diff ?? ""}`,
    { proposal: p }
  );
}

export async function propose(
  args: SkillOperationArgs,
  deps: SkillOperationsDeps,
  now: number
): Promise<SkillOperationResult> {
  if (typeof args.content !== "string" || args.content.trim() === "") {
    return reply("propose", false, "invalid-args", "Give content: the full new SKILL.md.");
  }
  const input = {
    content: args.content,
    summary: args.summary ?? "",
    evidenceTurnIds: parseTurnIds(args.evidence),
  };
  const index = getSkillIndex(deps.folders, now);
  const agentDeps = { store: deps.store, index, now };
  if (args.idea) {
    const name = args.idea.name?.trim();
    if (!name) return reply("propose", false, "invalid-args", "An idea needs a name.");
    const target = watchedTarget("propose", deps.folders, args.folder);
    if (isReply(target)) return target;
    await deps.store.init();
    return proposeReply(await proposeNewSkill(name, target.folder, input, agentDeps));
  }
  const skill = args.skill?.trim();
  if (!skill) return reply("propose", false, "invalid-args", "Give skill, or idea and folder.");
  const found = resolveSkillPath("propose", skill, index);
  if (isReply(found)) return found;
  await deps.store.init();
  return proposeReply(await proposeImprovement(found.path, input, agentDeps));
}

export async function undo(
  args: SkillOperationArgs,
  deps: SkillOperationsDeps,
  now: number
): Promise<SkillOperationResult> {
  if (!args.id) return reply("undo", false, "invalid-args", "Give the proposal id.");
  if (!(await getProposal(deps.store, args.id))) {
    return reply("undo", false, "not-found", `No proposal ${args.id}.`);
  }
  await deps.store.init();
  const result = await undoProposal(args.id, {
    store: deps.store,
    folders: deps.folders,
    now: () => now,
  });
  if (!result.ok) {
    const data =
      result.savedContent === undefined ? undefined : { savedContent: result.savedContent };
    return reply("undo", false, result.code, result.message, data);
  }
  return reply("undo", true, "undone", `Undid proposal ${args.id} and restored ${result.path}.`, {
    proposal: result.proposal,
    path: result.path,
  });
}
