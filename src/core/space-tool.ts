import type { MemoryOperationArgs } from "./memory-operations.js";

/**
 * The `space` mode of the `memory` tool. It loads on demand, so the other modes never import
 * the space code. It needs no embedding model and no open memory store.
 */
export async function runSpaceMode(
  args: MemoryOperationArgs,
  directory: string
): Promise<Record<string, unknown>> {
  const { getActiveSpace, refreshConfigIfChanged } = await import("../config.js");
  const { executeSpaceOperation } = await import("../services/spaces/operations.js");
  const { spaceFiles } = await import("../services/spaces/registry-store.js");
  const { ommsHomeDir } = await import("../services/spaces/storage-resolution.js");
  const result = await executeSpaceOperation(
    { action: args.spaceAction, name: args.spaceName },
    { files: spaceFiles(ommsHomeDir()), current: getActiveSpace() }
  );
  // A switch made here takes effect in this process now, not only on its next config refresh.
  refreshConfigIfChanged(directory);
  return result;
}
