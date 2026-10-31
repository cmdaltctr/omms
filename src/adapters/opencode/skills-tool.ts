import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import {
  SKILLS_TOOL_DESCRIPTION,
  SKILLS_TOOL_MODES,
  runSkillsTool,
  type SkillsToolArgs,
} from "../../core/skills-tool.js";

/** The OpenCode `skills` tool. V2 reaches it through the V1 plugin's `tool.skills`. */
export function opencodeSkillsTool(directory: string): ToolDefinition {
  return tool({
    description: SKILLS_TOOL_DESCRIPTION,
    args: {
      mode: tool.schema.enum(SKILLS_TOOL_MODES).optional(),
      skill: tool.schema.string().optional(),
      id: tool.schema.string().optional(),
      state: tool.schema.string().optional(),
      order: tool.schema.string().optional(),
      folder: tool.schema.string().optional(),
      idea: tool.schema
        .object({
          name: tool.schema.string().optional(),
          description: tool.schema.string().optional(),
        })
        .optional(),
      limit: tool.schema.number().optional(),
      content: tool.schema.string().optional(),
      summary: tool.schema.string().optional(),
      evidence: tool.schema.array(tool.schema.number()).optional(),
    },
    async execute(args: SkillsToolArgs) {
      return runSkillsTool(args, directory);
    },
  });
}
