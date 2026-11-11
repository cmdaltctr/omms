import {
  executeMemoryOperation,
  type MemoryOperationArgs,
  type MemoryOperationContext,
} from "../../core/memory-operations.js";

/** Run the OpenCode `memory` tool. The V2 plugin registers it in `src/v2/tools.ts`. */
export async function runOpencodeMemoryTool(
  args: MemoryOperationArgs,
  base: Pick<MemoryOperationContext, "directory" | "tags">,
  sessionID: string | undefined
): Promise<string> {
  // The session ID lets `memorise` replace its own snapshot.
  const result = await executeMemoryOperation(args, {
    ...base,
    host: "opencode",
    hostSessionId: sessionID,
  });
  return JSON.stringify(result);
}
