import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  SKILLS_TOOL_DESCRIPTION,
  SKILLS_TOOL_MODES,
  runSkillsTool,
} from "../../core/skills-tool.js";

/** The Pi `skills` tool, registered beside `memory`. */
export function registerPiSkillsTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "skills",
    label: "Skills",
    description: SKILLS_TOOL_DESCRIPTION,
    parameters: Type.Object({
      mode: Type.Optional(Type.Union(SKILLS_TOOL_MODES.map((mode) => Type.Literal(mode)))),
      skill: Type.Optional(Type.String()),
      id: Type.Optional(Type.String()),
      state: Type.Optional(Type.String()),
      order: Type.Optional(Type.String()),
      folder: Type.Optional(Type.String()),
      idea: Type.Optional(
        Type.Object({
          name: Type.Optional(Type.String()),
          description: Type.Optional(Type.String()),
        })
      ),
      limit: Type.Optional(Type.Number()),
      content: Type.Optional(Type.String()),
      summary: Type.Optional(Type.String()),
      evidence: Type.Optional(Type.Array(Type.Number())),
    }),
    async execute(_toolCallId, args, _signal, _onUpdate, ctx) {
      return {
        content: [{ type: "text" as const, text: await runSkillsTool(args, ctx.cwd) }],
        details: {},
      };
    },
  });
}
