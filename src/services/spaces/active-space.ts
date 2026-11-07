import { existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../logger.js";
import {
  DEFAULT_SPACE_ID,
  DEFAULT_SPACE_NAME,
  findSpace,
  readRegistryFile,
  resolveSpaceFolder,
} from "./registry.js";

/** Which space the process uses, and the storage folder that choice gives. */
export interface ActiveSpace {
  id: string;
  name: string;
  /** The space folder. Unset when the Default space or a project folder applies. */
  storagePath?: string;
  /** A project config sets its own `storagePath`, which wins over the active space. */
  customStoragePath: boolean;
  /** Why OMMS used Default although the registry named another space. */
  problem?: string;
}

/**
 * Picks the active space for config loading (design D2). Reads paths from arguments
 * and never imports CONFIG. A problem always falls back to the Default space.
 */
export function resolveActiveSpace(
  ommsDir: string,
  globalStoragePath: string,
  projectSetsStoragePath: boolean
): ActiveSpace {
  const fallback = (problem?: string): ActiveSpace => {
    // The spec wants an unusable registry named in the log, not only in the web status.
    if (problem) log("Active space fallback to Default", { problem }, "warn");
    return {
      id: DEFAULT_SPACE_ID,
      name: DEFAULT_SPACE_NAME,
      customStoragePath: projectSetsStoragePath,
      problem,
    };
  };
  const { registry, problem } = readRegistryFile(join(ommsDir, "spaces.json"));
  if (problem) return fallback(problem);
  const space = findSpace(registry, registry.activeSpaceId);
  if (!space || space.id === DEFAULT_SPACE_ID) return fallback();
  if (projectSetsStoragePath) {
    return { id: space.id, name: space.name, customStoragePath: true };
  }
  const folder = resolveSpaceFolder(space.id, {
    globalStoragePath,
    spacesRoot: join(ommsDir, "spaces"),
  });
  if (!existsSync(folder)) {
    return fallback(`The folder of space "${space.name}" is missing; using the Default space.`);
  }
  return { id: space.id, name: space.name, storagePath: folder, customStoragePath: false };
}
