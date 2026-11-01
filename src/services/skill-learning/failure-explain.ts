import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  profileFailureCode,
  profileResultCode,
  type ProfileFailureCode,
} from "../../core/profile-failure.js";
import { log } from "../logger.js";
import type { ToolCallResult } from "../ai/providers/base-provider.js";
import { tool, type SkillModel } from "./drafting.js";
import { skillFailureGroups, type FailureGroup } from "./failures.js";
import type { SkillIndex } from "./skill-index.js";
import type { SkillStore } from "./store.js";

/** At most this many groups go to the model, most calls first. */
export const MAX_EXPLAIN_GROUPS = 10;
/** One input excerpt per group, cut to this many characters. */
export const EXPLAIN_EXCERPT_CHARS = 500;

/** What a cause is blamed on; the panel shows the label as a lead. */
export type ExplainCauseKind = "skill" | "harness" | "environment" | "unknown";

export interface ExplainCause {
  kind: ExplainCauseKind;
  explanation: string;
  actions: string[];
}

/** The model's reply: a summary and labelled causes. Shown, never saved. */
export interface FailureExplanation {
  summary: string;
  causes: ExplainCause[];
}

export type ExplainFailureCode = ProfileFailureCode | "not-found" | "invalid-args";

export type ExplainResult =
  | { ok: true; explanation: FailureExplanation }
  | { ok: false; code: ExplainFailureCode; message: string };

export interface ExplainDeps {
  store: SkillStore;
  index: SkillIndex;
  model: SkillModel;
}

const ExplainReply = z.object({
  summary: z.string(),
  causes: z
    .array(
      z.object({
        kind: z.enum(["skill", "harness", "environment", "unknown"]),
        explanation: z.string(),
        actions: z.array(z.string()).default([]),
      })
    )
    .default([]),
});

const EXPLAIN_TOOL = tool("explain_skill_failures", "Explain a skill's failed tool calls", {
  summary: { type: "string", description: "One or two plain sentences on what fails and why" },
  causes: {
    type: "array",
    items: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["skill", "harness", "environment", "unknown"],
          description:
            "skill: the SKILL.md should change; harness: a host or harness bug; environment: machine, setup or credentials; unknown",
        },
        explanation: { type: "string", description: "What the error text shows" },
        actions: {
          type: "array",
          items: { type: "string" },
          description: "Suggested actions, as leads from the error text only",
        },
      },
      required: ["kind", "explanation", "actions"],
    },
  },
});

const EXPLAIN_SYSTEM = [
  "You explain why a coding agent's tool calls failed while it used one skill (SKILL.md).",
  "You see the skill file and its failure groups: tool name, first error line, counts, the last time seen and one short input excerpt. You cannot see the host's code.",
  "Label each cause skill, harness, environment or unknown. Treat your labels and suggested actions as leads from error text only, not conclusions.",
  "Write plain British English. Call the explain_skill_failures tool.",
].join(" ");

const FAILURE_TEXT: Partial<Record<ExplainFailureCode, string>> = {
  "not-configured": "The external API is not set up. Set it up in the External API card.",
  "invalid-args": "This skill has no failed tool calls to explain.",
  "invalid-reply": "The model reply was not valid, so nothing is shown. Try again.",
  timeout: "The model did not reply in time",
};

/** Log one metadata record with the reason code only, and return the failure. */
function fail(
  step: string,
  code: ExplainFailureCode
): {
  ok: false;
  code: ExplainFailureCode;
  message: string;
} {
  log(`Skill ${step} failed`, { host: null, reason: code }, "error");
  return { ok: false, code, message: FAILURE_TEXT[code] ?? `Explaining failed: ${code}` };
}

function groupLine(group: FailureGroup): string {
  const parts = [
    `- Tool: ${group.name}`,
    `Error: ${group.errorLine ?? "(no error text)"}`,
    `Calls: ${group.calls} over ${group.turns} turns`,
    `Last seen: ${new Date(group.lastSeenAt).toISOString()}`,
  ];
  const call = group.latest[0];
  if (call) {
    parts.push(`Input excerpt: "${call.input.slice(0, EXPLAIN_EXCERPT_CHARS)}"`);
  }
  return parts.join("; ");
}

/**
 * Builds the request the test asserts on: the skill name, its `SKILL.md` when
 * a watched folder holds it, and the top groups. No prompts, no replies.
 */
export function explainUserPrompt(
  skill: { name: string; path: string | null },
  skillFile: string | null,
  groups: readonly FailureGroup[]
): string {
  const file =
    skillFile === null ? "(not in a watched folder; no SKILL.md)" : `<<<\n${skillFile}\n>>>`;
  return [
    `Skill: ${skill.name}`,
    `SKILL.md:\n${file}`,
    `Failure groups, most calls first:`,
    groups.map(groupLine).join("\n") || "(none)",
  ].join("\n\n");
}

/**
 * Asks the external API model to explain one skill's failure groups (design
 * §9). The reply is returned, never saved. Reuses the drafting model path and
 * its failure codes, including `not-configured`.
 */
export async function explainFailures(
  skill: { name: string; path: string | null },
  deps: ExplainDeps
): Promise<ExplainResult> {
  if (!deps.model.ready) return fail("explain failures", "not-configured");
  const groups = (await skillFailureGroups(deps.store, skill, deps.index)).slice(
    0,
    MAX_EXPLAIN_GROUPS
  );
  if (groups.length === 0) return fail("explain failures", "invalid-args");
  let skillFile: string | null = null;
  if (skill.path) {
    try {
      skillFile = readFileSync(skill.path, "utf8");
    } catch {
      skillFile = null;
    }
  }
  const user = explainUserPrompt(skill, skillFile, groups);
  let result: ToolCallResult;
  try {
    result = await deps.model.callTool(EXPLAIN_SYSTEM, user, EXPLAIN_TOOL);
  } catch (error) {
    return fail("explain failures", profileFailureCode(error));
  }
  if (!result.success) return fail("explain failures", profileResultCode(result));
  const parsed = ExplainReply.safeParse(result.data);
  if (!parsed.success) return fail("explain failures", "invalid-reply");
  return {
    ok: true,
    explanation: {
      summary: parsed.data.summary.trim(),
      causes: parsed.data.causes.map((cause) => ({
        kind: cause.kind,
        explanation: cause.explanation.trim(),
        actions: cause.actions.map((action) => action.trim()).filter(Boolean),
      })),
    },
  };
}
