import { applyProposal } from "../services/skill-learning/apply.js";
import {
  draftImprovement,
  draftNewSkill,
  findSkillIdeas,
  type DraftResult,
  type SkillIdea,
  type SkillModel,
} from "../services/skill-learning/drafting.js";
import {
  getProposal,
  listProposals,
  updateProposalState,
  type SkillProposal,
  type SkillProposalState,
} from "../services/skill-learning/proposal-store.js";
import {
  SKILL_ORDERS,
  rankSkills,
  type SkillOrder,
  type SkillRanking,
} from "../services/skill-learning/ranking.js";
import { getSkillIndex } from "../services/skill-learning/skill-index.js";
import type { SkillStore } from "../services/skill-learning/store.js";
import { evidence, propose, undo } from "./skill-agent-modes.js";
import { reply, resolveSkillPath, watchedTarget } from "./skill-operation-reply.js";

/**
 * The `skills` tool and the `om-memory-system skills` command share these
 * mode handlers and replies (design §8). The caller builds the deps from the
 * config; `services/skill-learning/operations-deps.ts` does that.
 */

export const SKILL_OPERATION_MODES = [
  "list",
  "ideas",
  "draft",
  "evidence",
  "propose",
  "proposals",
  "show",
  "apply",
  "reject",
  "undo",
  "help",
] as const;

export type SkillOperationMode = (typeof SKILL_OPERATION_MODES)[number];

const PROPOSAL_STATES: readonly SkillProposalState[] = [
  "pending",
  "applied",
  "stale",
  "rejected",
  "undone",
];

export interface SkillOperationArgs {
  /** Draft: a skill name, or the full path of its `SKILL.md`. */
  skill?: string;
  /** Draft a new skill: an idea from `ideas`. Needs `folder`. */
  idea?: Partial<SkillIdea>;
  /** Draft a new skill: the watched folder to put it in. */
  folder?: string;
  /** Show, apply, reject: the proposal id. */
  id?: string;
  /** Proposals: only proposals in this state. */
  state?: string;
  /** List: `uses` (default) or `attention`. */
  order?: string;
  /** Evidence: how many recorded turns, 1 to 20 (default 10). */
  limit?: number | string;
  /** Propose: the full new `SKILL.md`. */
  content?: string;
  /** Propose: what changed and why. */
  summary?: string;
  /** Propose: the turn ids that show the need, as numbers, `T12` labels or `12,14`. */
  evidence?: Array<number | string> | string;
}

export interface SkillOperationsDeps {
  /** `skillLearning` in the config. */
  enabled: boolean;
  store: SkillStore;
  /** The watched skill folders. */
  folders: readonly string[];
  model: SkillModel;
  /** Recorded on apply: `agent` for the host tools, `person` for the terminal. */
  appliedBy: "person" | "agent";
  now?: () => number;
}

export interface SkillOperationResult {
  success: boolean;
  mode: string;
  /** A fixed outcome code, such as `ok`, `recording-off` or `not-found`. */
  code: string;
  /** The plain-English reply for an agent or a terminal. */
  text: string;
  /** Structured data for JSON output. */
  data?: Record<string, unknown>;
}

export const RECORDING_OFF_TEXT =
  "Skill learning is off, so OMMS records no turns for skills. Turn it on in Settings → Skill learning, or set `skillLearning: true` in the global config.";

const HELP: Array<{ mode: SkillOperationMode; args: string; description: string }> = [
  {
    mode: "list",
    args: "order?",
    description: "Skills ranked by use in the last 30 days, or by attention with order attention",
  },
  { mode: "ideas", args: "", description: "Up to three new skill ideas from recorded turns" },
  {
    mode: "draft",
    args: "skill | idea + folder",
    description: "Draft an improvement for a skill, or a new skill from an idea",
  },
  {
    mode: "evidence",
    args: "skill, limit?",
    description: "A skill's SKILL.md, its numbers and its recorded turns, failed ones first",
  },
  {
    mode: "propose",
    args: "skill | idea + folder, content, summary, evidence?",
    description: "Save your own fixed SKILL.md as a pending proposal; no external API call",
  },
  { mode: "proposals", args: "state?", description: "List proposals, newest first" },
  { mode: "show", args: "id", description: "One proposal with its summary, evidence and diff" },
  { mode: "apply", args: "id", description: "Write a pending proposal to its SKILL.md" },
  { mode: "reject", args: "id", description: "Reject a pending proposal" },
  { mode: "undo", args: "id", description: "Restore the file an applied proposal changed" },
  { mode: "help", args: "", description: "This list" },
];

function day(ms: number | null): string {
  return ms === null ? "never" : new Date(ms).toISOString().slice(0, 10);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function rankingLine(skill: SkillRanking): string {
  const parts = [
    plural(skill.uses, "use"),
    plural(skill.failedTurns, "failed turn"),
    `last used ${day(skill.lastUsedAt)}`,
    `attention ${skill.attention.toFixed(2)}`,
    skill.mode,
  ];
  if (skill.suggested) parts.push("Suggested");
  if (skill.notInWatchedFolder) parts.push("Not in a watched folder");
  const line = `- ${skill.name}: ${parts.join(", ")}`;
  return skill.path ? `${line}\n  ${skill.path}` : line;
}

function proposalLine(p: SkillProposal): string {
  const summary = p.summary ? `: ${p.summary}` : "";
  return `- ${p.id} ${p.state} ${p.kind} ${p.skillName} (${day(p.createdAt)})${summary}`;
}

function stateNote(p: SkillProposal): string | null {
  if (p.state === "pending" && p.draftedBy === "agent") return "Written by the agent";
  if (p.state === "stale") return "Stale: the file changed since this draft";
  if (p.state === "applied" && p.appliedBy === "automatic") return "Applied automatically";
  if (p.state === "applied" && p.appliedBy) return `Applied by ${p.appliedBy}`;
  return null;
}

function proposalText(p: SkillProposal): string {
  const lines = [
    `Proposal ${p.id}`,
    `Skill: ${p.skillName} (${p.kind === "new" ? "new skill" : "improvement"})`,
    `File: ${p.skillPath ?? "none"}`,
    `State: ${p.state}`,
  ];
  const note = stateNote(p);
  if (note) lines.push(note);
  lines.push(`Summary: ${p.summary || "none"}`);
  const evidence = p.evidenceTurnIds.map((id) => `T${id}`).join(", ");
  lines.push(`Evidence turns: ${evidence || "none"}`);
  lines.push("", "Diff:", p.diff || "(no diff)");
  return lines.join("\n");
}

function draftReply(mode: string, result: DraftResult): SkillOperationResult {
  if (!result.ok) return reply(mode, false, result.code, result.message);
  if (result.code === "no-change") return reply(mode, true, "no-change", result.message);
  const p = result.proposal;
  return reply(
    mode,
    true,
    "proposed",
    `Saved pending proposal ${p.id} for ${p.skillName}. Review it with show, then apply or reject it.`,
    { proposal: p }
  );
}

async function list(
  args: SkillOperationArgs,
  deps: SkillOperationsDeps,
  now: number
): Promise<SkillOperationResult> {
  const order = (args.order ?? "uses") as SkillOrder;
  if (!SKILL_ORDERS.includes(order)) {
    return reply(
      "list",
      false,
      "invalid-args",
      `order must be one of: ${SKILL_ORDERS.join(", ")}.`
    );
  }
  const skills = await rankSkills(deps.store, getSkillIndex(deps.folders, now), now, order);
  if (skills.length === 0) {
    return reply("list", true, "ok", "No skills found in the watched folders.", {
      skills,
      folders: deps.folders,
    });
  }
  const heading = order === "attention" ? "Skills by attention" : "Skills by use";
  const text = [`${heading} in the last 30 days:`, ...skills.map(rankingLine)].join("\n");
  return reply("list", true, "ok", text, { skills });
}

async function ideas(deps: SkillOperationsDeps, now: number): Promise<SkillOperationResult> {
  const result = await findSkillIdeas(draftDeps(deps, now));
  if (!result.ok) return reply("ideas", false, result.code, result.message);
  if (result.ideas.length === 0) {
    return reply("ideas", true, "ok", "No new skill ideas in the recorded turns.", { ideas: [] });
  }
  const lines = result.ideas.map((idea, i) => {
    const evidence = idea.evidenceTurnIds.map((id) => `T${id}`).join(", ") || "none";
    return `${i + 1}. ${idea.name}: ${idea.description}\n   Why: ${idea.reason}\n   Evidence turns: ${evidence}`;
  });
  lines.push("To draft one, call draft with the idea and a watched folder.");
  return reply("ideas", true, "ok", lines.join("\n"), { ideas: result.ideas });
}

function draftDeps(deps: SkillOperationsDeps, now: number) {
  return {
    store: deps.store,
    index: getSkillIndex(deps.folders, now),
    model: deps.model,
    now: () => now,
  };
}

async function draftNew(
  args: SkillOperationArgs,
  deps: SkillOperationsDeps,
  now: number
): Promise<SkillOperationResult> {
  const { idea, folder } = args;
  if (!idea?.name || !idea.description) {
    return reply("draft", false, "invalid-args", "An idea needs a name and a description.");
  }
  const target = watchedTarget("draft", deps.folders, folder);
  if (isReply(target)) return target;
  await deps.store.init();
  const full: SkillIdea = {
    name: idea.name,
    description: idea.description,
    reason: idea.reason ?? "",
    evidenceTurnIds: idea.evidenceTurnIds ?? [],
  };
  return draftReply("draft", await draftNewSkill(full, target.folder, draftDeps(deps, now)));
}

async function draft(
  args: SkillOperationArgs,
  deps: SkillOperationsDeps,
  now: number
): Promise<SkillOperationResult> {
  if (args.idea) return draftNew(args, deps, now);
  const skill = args.skill?.trim();
  if (!skill) return reply("draft", false, "invalid-args", "Give skill, or idea and folder.");
  const index = getSkillIndex(deps.folders, now);
  const found = resolveSkillPath("draft", skill, index);
  if (isReply(found)) return found;
  await deps.store.init();
  return draftReply(
    "draft",
    await draftImprovement(found.path, { ...draftDeps(deps, now), index })
  );
}

async function proposals(
  args: SkillOperationArgs,
  deps: SkillOperationsDeps
): Promise<SkillOperationResult> {
  const state = args.state as SkillProposalState | undefined;
  if (state && !PROPOSAL_STATES.includes(state)) {
    return reply(
      "proposals",
      false,
      "invalid-args",
      `state must be one of: ${PROPOSAL_STATES.join(", ")}.`
    );
  }
  const found = await listProposals(deps.store, state ? { state } : {});
  const text =
    found.length === 0
      ? `No ${state ? `${state} ` : ""}proposals.`
      : ["Proposals, newest first:", ...found.map(proposalLine)].join("\n");
  return reply("proposals", true, "ok", text, { proposals: found });
}

/** The proposal for `args.id`, or the reply that explains why there is none. */
async function findProposal(
  mode: string,
  args: SkillOperationArgs,
  deps: SkillOperationsDeps
): Promise<SkillProposal | SkillOperationResult> {
  if (!args.id) return reply(mode, false, "invalid-args", "Give the proposal id.");
  const proposal = await getProposal(deps.store, args.id);
  return proposal ?? reply(mode, false, "not-found", `No proposal ${args.id}.`);
}

function isReply(value: object): value is SkillOperationResult {
  return "code" in value;
}

async function show(
  args: SkillOperationArgs,
  deps: SkillOperationsDeps
): Promise<SkillOperationResult> {
  const found = await findProposal("show", args, deps);
  if (isReply(found)) return found;
  return reply("show", true, "ok", proposalText(found), { proposal: found });
}

async function apply(
  args: SkillOperationArgs,
  deps: SkillOperationsDeps,
  now: number
): Promise<SkillOperationResult> {
  const found = await findProposal("apply", args, deps);
  if (isReply(found)) return found;
  await deps.store.init();
  const result = await applyProposal(found.id, deps.appliedBy, {
    store: deps.store,
    folders: deps.folders,
    now: () => now,
  });
  if (!result.ok) return reply("apply", false, result.code, result.message);
  return reply("apply", true, "applied", `Applied proposal ${found.id} to ${result.path}.`, {
    proposal: result.proposal,
    path: result.path,
  });
}

async function reject(
  args: SkillOperationArgs,
  deps: SkillOperationsDeps,
  now: number
): Promise<SkillOperationResult> {
  const found = await findProposal("reject", args, deps);
  if (isReply(found)) return found;
  if (found.state !== "pending") {
    return reply(
      "reject",
      false,
      "not-pending",
      `Proposal ${found.id} is ${found.state}. Only a pending proposal can be rejected.`
    );
  }
  await deps.store.init();
  await updateProposalState(deps.store, found.id, "rejected", now);
  return reply("reject", true, "rejected", `Rejected proposal ${found.id}.`, {
    proposal: { ...found, state: "rejected", updatedAt: now },
  });
}

function help(): SkillOperationResult {
  const lines = HELP.map((h) => `- ${h.mode}${h.args ? ` (${h.args})` : ""}: ${h.description}`);
  return reply("help", true, "ok", ["Skills tool modes:", ...lines].join("\n"), { modes: HELP });
}

/** Modes that read recorded turns. They need skill learning on. */
const RECORDING_MODES = new Set<string>(["list", "ideas", "draft", "evidence"]);

/**
 * Runs one `skills` mode. Expected outcomes return a result with a code;
 * an unexpected error returns `success: false` with code `error`.
 */
export async function runSkillOperation(
  mode: string | undefined,
  args: SkillOperationArgs,
  deps: SkillOperationsDeps
): Promise<SkillOperationResult> {
  const name = mode || "help";
  if (!(SKILL_OPERATION_MODES as readonly string[]).includes(name)) {
    return reply(
      name,
      false,
      "invalid-args",
      `Unknown mode ${name}. Use one of: ${SKILL_OPERATION_MODES.join(", ")}.`
    );
  }
  if (RECORDING_MODES.has(name) && !deps.enabled) {
    return reply(name, false, "recording-off", RECORDING_OFF_TEXT);
  }
  const now = (deps.now ?? Date.now)();
  try {
    switch (name as SkillOperationMode) {
      case "list":
        return await list(args, deps, now);
      case "ideas":
        return await ideas(deps, now);
      case "draft":
        return await draft(args, deps, now);
      case "evidence":
        return await evidence(args, deps, now);
      case "propose":
        return await propose(args, deps, now);
      case "undo":
        return await undo(args, deps, now);
      case "proposals":
        return await proposals(args, deps);
      case "show":
        return await show(args, deps);
      case "apply":
        return await apply(args, deps, now);
      case "reject":
        return await reject(args, deps, now);
      case "help":
        return help();
    }
  } catch (error) {
    return reply(name, false, "error", error instanceof Error ? error.message : String(error));
  }
}
