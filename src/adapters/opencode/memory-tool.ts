import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import {
  executeMemoryOperation,
  type MemoryOperationArgs,
  type MemoryOperationContext,
} from "../../core/memory-operations.js";

/** The OpenCode V1 `memory` tool. V2 reaches it through the V1 plugin's `tool.memory`. */
export function opencodeMemoryTool(
  description: string,
  base: Pick<MemoryOperationContext, "directory" | "tags">
): ToolDefinition {
  return tool({
    description,
    args: {
      mode: tool.schema
        .enum([
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
        ])
        .optional(),
      content: tool.schema.string().optional(),
      query: tool.schema.string().optional(),
      tags: tool.schema.string().optional(),
      type: tool.schema.string().optional(),
      topic: tool.schema.string().optional(),
      done: tool.schema.string().optional(),
      doing: tool.schema.string().optional(),
      next: tool.schema.string().optional(),
      memoryId: tool.schema.string().optional(),
      limit: tool.schema.number().optional(),
      scope: tool.schema.enum(["project", "all-projects"]).optional(),
      fromPath: tool.schema.string().optional(),
      fromHash: tool.schema.string().optional(),
      outputPath: tool.schema.string().optional(),
      inputPath: tool.schema.string().optional(),
      dryRun: tool.schema.boolean().optional(),
      allowLinkedSource: tool.schema.boolean().optional(),
    },
    async execute(args: MemoryOperationArgs, context) {
      // The session ID lets `memorise` replace its own snapshot.
      const result = await executeMemoryOperation(args, {
        ...base,
        host: "opencode",
        hostSessionId: context?.sessionID,
      });
      return JSON.stringify(result);
    },
  });
}
