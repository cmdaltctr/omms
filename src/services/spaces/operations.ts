import { listSpaces, SpaceError, readRegistryFile, type SpaceRegistry } from "./registry.js";
import {
  archiveStoredSpace,
  createStoredSpace,
  switchStoredSpace,
  unarchiveStoredSpace,
  type SpaceFiles,
} from "./registry-store.js";

/**
 * The space operations an agent or a terminal may run: list, status, create, archive, unarchive
 * and use (switch). Delete, rename, backup and restore exist only in the web app (design D11),
 * because a person must confirm them. The CLI `space` command, the `memory` tool `space` mode
 * and the Claude Code plugin tool all call this one function, so the three hosts stay equal.
 */

export interface SpaceOperationArgs {
  action?: string;
  /** A space name or id. */
  name?: string;
}

export interface SpaceOperationContext {
  files: SpaceFiles;
  /** The space this process uses now, from the last config load. */
  current: { id: string; name: string; customStoragePath: boolean; problem?: string };
}

/** Actions that need a person at the web app, so the CLI and the `memory` tool refuse them. */
export const WEB_ONLY_SPACE_ACTIONS = ["delete", "rename", "backup", "restore"];
export const SPACE_ACTIONS = ["list", "status", "create", "archive", "unarchive", "use"];
const WEB_ONLY = WEB_ONLY_SPACE_ACTIONS;
const ACTIONS = SPACE_ACTIONS;

function summary(registry: SpaceRegistry) {
  return listSpaces(registry).map((space) => ({
    id: space.id,
    name: space.name,
    active: space.id === registry.activeSpaceId,
    archived: space.archived,
    createdAt: space.createdAt || undefined,
  }));
}

function activeOf(registry: SpaceRegistry) {
  const active = listSpaces(registry).find((space) => space.id === registry.activeSpaceId)!;
  return { id: active.id, name: active.name };
}

export async function executeSpaceOperation(
  args: SpaceOperationArgs,
  context: SpaceOperationContext
): Promise<Record<string, unknown>> {
  const action = (args.action ?? "list").toLowerCase();
  if (WEB_ONLY.includes(action)) {
    return { success: false, error: `Only the web app can ${action} a space.` };
  }
  if (!ACTIONS.includes(action)) {
    return {
      success: false,
      error: `Unknown space action "${args.action}". Actions: ${ACTIONS.join(", ")}.`,
    };
  }
  const name = args.name?.trim();
  if (["create", "archive", "unarchive", "use"].includes(action) && !name) {
    return { success: false, error: `The ${action} action needs a space name.` };
  }

  try {
    const read = readRegistryFile(context.files.registryPath);
    if (action === "list") {
      return {
        success: true,
        activeSpace: activeOf(read.registry),
        spaces: summary(read.registry),
        ...(read.problem ? { problem: read.problem } : {}),
      };
    }
    if (action === "status") {
      return {
        success: true,
        activeSpace: context.current,
        registryActiveSpace: activeOf(read.registry),
        ...(context.current.problem ? { problem: context.current.problem } : {}),
      };
    }
    if (action === "create") {
      const space = await createStoredSpace(context.files, name!);
      return {
        success: true,
        space: { id: space.id, name: space.name },
        message: `Created space "${space.name}". Use the "use" action to make it active.`,
      };
    }
    const change = {
      archive: archiveStoredSpace,
      unarchive: unarchiveStoredSpace,
      use: switchStoredSpace,
    }[action as "archive" | "unarchive" | "use"];
    const registry = await change(context.files, name!);
    const active = activeOf(registry);
    return {
      success: true,
      activeSpace: active,
      message:
        action === "use"
          ? `Active space is now "${active.name}". It applies from the next turn.`
          : `Space "${name}" is now ${action === "archive" ? "archived" : "not archived"}.`,
    };
  } catch (error) {
    if (error instanceof SpaceError) return { success: false, error: error.message };
    throw error;
  }
}
