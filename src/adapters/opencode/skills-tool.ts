import { runSkillsTool, type SkillsToolArgs } from "../../core/skills-tool.js";
import type { SkillConfigModule } from "../../services/skill-learning/settings-for.js";

/** Run the OpenCode `skills` tool. The V2 plugin registers it in `src/v2/tools.ts`. */
export function runOpencodeSkillsTool(
  args: SkillsToolArgs,
  directory: string,
  config: SkillConfigModule
) {
  return runSkillsTool(args, directory, config);
}
