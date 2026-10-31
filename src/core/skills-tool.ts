/**
 * The `skills` tool that Pi and OpenCode register beside `memory` (design §8).
 * The operations, their store and the model load with `import()` on the first
 * call, so the plugin bundles stay light. A call records `agent` on apply.
 */

/** Same list as `SKILL_OPERATION_MODES`; a test keeps the two equal. */
export const SKILLS_TOOL_MODES = [
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

export const SKILLS_TOOL_DESCRIPTION = [
  "Lists this project's skills ranked by use, drafts improvements as reviewable proposals, and applies a proposal only when the user asks.",
  'mode "list" (order "uses" or "attention"): skills ranked by use in the last 30 days, or by attention. "ideas": up to three new skill ideas from recorded turns.',
  '"draft" (skill, or idea {name, description} with folder): the external API drafts a pending proposal; it changes no file.',
  'To fix a skill yourself: call "evidence" (skill, limit) for its SKILL.md and recorded turns, write the fixed SKILL.md, then call "propose" (skill, or idea with folder; content, summary, evidence turn ids). Show the user the diff.',
  "This path makes no external API call, but the recorded turn text enters this session.",
  '"proposals" (state), "show" (id): review proposals and their diffs.',
  '"apply" (id): write a pending proposal to its SKILL.md, only when the user asks. "reject" (id), "undo" (id), "help".',
].join(" ");

/** JSON Schema for the tool input; the V2 adapter passes it as is. */
export const SKILLS_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: [...SKILLS_TOOL_MODES] },
    skill: { type: "string" },
    id: { type: "string" },
    state: { type: "string" },
    order: { type: "string", enum: ["uses", "attention"] },
    folder: { type: "string" },
    idea: {
      type: "object",
      properties: { name: { type: "string" }, description: { type: "string" } },
    },
    limit: { type: "number" },
    content: { type: "string" },
    summary: { type: "string" },
    evidence: { type: "array", items: { type: "number" } },
  },
  additionalProperties: false,
} as const;

export interface SkillsToolArgs {
  mode?: string;
  skill?: string;
  id?: string;
  state?: string;
  order?: string;
  folder?: string;
  idea?: { name?: string; description?: string };
  limit?: number;
  content?: string;
  summary?: string;
  evidence?: number[];
}

/** Run one `skills` tool call for the project in `directory`; returns the result as JSON. */
export async function runSkillsTool(args: SkillsToolArgs, directory: string): Promise<string> {
  const [{ runSkillOperation }, { skillOperationsDeps }] = await Promise.all([
    import("./skill-operations.js"),
    import("../services/skill-learning/operations-deps.js"),
  ]);
  const { mode, ...rest } = args;
  const result = await runSkillOperation(mode, rest, skillOperationsDeps(directory, "agent"));
  return JSON.stringify(result);
}
