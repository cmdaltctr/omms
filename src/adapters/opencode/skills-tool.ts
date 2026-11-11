import { runSkillsTool, type SkillsToolArgs } from "../../core/skills-tool.js";

/** Run the OpenCode `skills` tool. The V2 plugin registers it in `src/v2/tools.ts`. */
export function runOpencodeSkillsTool(args: SkillsToolArgs, directory: string) {
  return runSkillsTool(args, directory);
}
