import type { Context } from "@opencode/plugin/promise/plugin";
import { SKILLS_TOOL_DESCRIPTION, SKILLS_TOOL_INPUT_SCHEMA } from "../core/skills-tool.js";
import { memoryToolDescription } from "../core/memory-tool-text.js";
import type { MemoryOperationContext } from "../core/memory-operations.js";
import { runOpencodeMemoryTool } from "../adapters/opencode/memory-tool.js";
import { runOpencodeSkillsTool } from "../adapters/opencode/skills-tool.js";

export const memoryInput = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: [
        "add",
        "memorise",
        "memorize",
        "recall",
        "search",
        "profile",
        "list",
        "forget",
        "help",
        "migrate",
        "list-shards",
        "export",
        "import",
        "space",
      ],
    },
    content: { type: "string" },
    query: { type: "string" },
    tags: { type: "string" },
    type: { type: "string" },
    topic: { type: "string" },
    done: { type: "string" },
    doing: { type: "string" },
    next: { type: "string" },
    memoryId: { type: "string" },
    limit: { type: "number" },
    scope: { type: "string", enum: ["project", "all-projects"] },
    fromPath: { type: "string" },
    fromHash: { type: "string" },
    outputPath: { type: "string" },
    inputPath: { type: "string" },
    dryRun: { type: "boolean" },
    allowLinkedSource: { type: "boolean" },
    spaceAction: { type: "string" },
    spaceName: { type: "string" },
    spaceTo: { type: "string" },
    spaceSince: { type: "string" },
    spaceUntil: { type: "string" },
    spaceProject: { type: "string" },
    spaceIn: { type: "string" },
  },
  additionalProperties: false,
} as const;

/** What OpenCode passes to a tool call that the executors read. */
export type OpencodeToolCall = {
  readonly sessionID?: string;
  readonly messageID?: string;
  readonly agent?: string;
};

export type OpencodeToolExecutor = {
  readonly description: string;
  readonly execute: (args: any, call: OpencodeToolCall) => Promise<string>;
};

export type OpencodeTools = {
  readonly memory: OpencodeToolExecutor;
  readonly skills: OpencodeToolExecutor;
};

/** The `memory` and `skills` executors over the shared operations. */
export function createOpencodeTools(
  base: Pick<MemoryOperationContext, "directory" | "tags">,
  languageName: string
): OpencodeTools {
  return {
    memory: {
      description: memoryToolDescription(languageName),
      execute: (args, call) => runOpencodeMemoryTool(args, base, call.sessionID),
    },
    skills: {
      description: SKILLS_TOOL_DESCRIPTION,
      execute: (args) => runOpencodeSkillsTool(args, base.directory),
    },
  };
}

/**
 * Register each tool as a direct V2 tool, like OpenCode's own read/grep/skill, not a
 * Code Mode catalog entry, so the model can always see and call it (as on Pi).
 */
export async function registerOpencodeTools(ctx: Context, tools: OpencodeTools): Promise<void> {
  const definition = (name: keyof OpencodeTools, input: unknown) => ({
    name,
    description: tools[name].description,
    input: input as any,
    options: { codemode: false },
    execute: async (args: any, toolContext: any) => ({
      content: await tools[name].execute(args, {
        sessionID: toolContext?.sessionID,
        messageID: toolContext?.messageID,
        agent: toolContext?.agent,
      }),
    }),
  });
  await ctx.tool.transform((editor) => {
    editor.add(definition("memory", memoryInput) as any);
    editor.add(definition("skills", SKILLS_TOOL_INPUT_SCHEMA) as any);
  });
}
