import type { MemoryOperationArgs } from "./memory-operations.js";
import type { SpaceOperationSettings } from "../services/spaces/operations.js";

/**
 * The `space` mode of the `memory` tool. It loads on demand, so the other modes never import
 * the space code. `list`, `use` and `create` need no embedding model and no open memory store;
 * `preview` and `copy` open space stores, so only they carry the settings snapshot.
 */

/** The actions that read or write a space store, so their settings are loaded only for them. */
const STORE_ACTIONS = new Set(["preview", "copy"]);

/** Snapshots the settings the space-bound operations need from a CONFIG-shaped object. */
export function spaceOperationSettings(
  config: {
    skillStoragePath?: string;
    storagePath: string;
    embeddingModel: string;
    embeddingDimensions: number;
    maxVectorsPerShard: number;
  },
  spacesRoot: string
): SpaceOperationSettings {
  return {
    paths: {
      // Default's folder is the global store, even while a space or project folder is in use.
      globalStoragePath: config.skillStoragePath ?? config.storagePath,
      spacesRoot,
    },
    embedding: { model: config.embeddingModel, dimensions: config.embeddingDimensions },
    maxVectorsPerShard: config.maxVectorsPerShard,
  };
}

export async function runSpaceMode(
  args: MemoryOperationArgs,
  directory: string
): Promise<Record<string, unknown>> {
  const { CONFIG, getActiveSpace, refreshConfigIfChanged } = await import("../config.js");
  const { executeSpaceOperation } = await import("../services/spaces/operations.js");
  const { spaceFiles } = await import("../services/spaces/registry-store.js");
  const { ommsHomeDir } = await import("../services/spaces/storage-resolution.js");
  const files = spaceFiles(ommsHomeDir());
  const action = args.spaceAction?.trim().toLowerCase();
  const result = await executeSpaceOperation(
    {
      action: args.spaceAction,
      name: args.spaceName,
      ...(args.spaceTo === undefined ? {} : { to: args.spaceTo }),
      ...(args.spaceSince === undefined ? {} : { since: args.spaceSince }),
      ...(args.spaceUntil === undefined ? {} : { until: args.spaceUntil }),
      ...(args.spaceProject === undefined ? {} : { project: args.spaceProject }),
      ...(args.spaceIn === undefined ? {} : { owner: args.spaceIn }),
    },
    {
      files,
      current: getActiveSpace(),
      // The transfer actions open space stores, so only they get the settings (design D8).
      ...(STORE_ACTIONS.has(action ?? "")
        ? { settings: spaceOperationSettings(CONFIG, files.spacesRoot) }
        : {}),
    }
  );
  // A switch made here takes effect in this process now, not only on its next config refresh.
  refreshConfigIfChanged(directory);
  return result;
}
