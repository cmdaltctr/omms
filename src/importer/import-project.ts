import { statSync } from "node:fs";
import type { ImportPathMap } from "./importer.js";

/** How a recorded session directory was turned into a project directory. */
export type ProjectResolution = "mapped" | "recorded" | "worktree" | "unresolved";

export interface ResolvedImportProject {
  directory: string | null;
  via: ProjectResolution;
}

function isDirectory(path: string | null | undefined): path is string {
  if (!path) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * One rule for both hosts, shared by the web session list and the importers so
 * the listed set and the imported set always agree. An exact directory map
 * wins, because it is an explicit user choice; a map whose target is missing
 * leaves the session unresolved rather than silently falling back. OpenCode
 * alone passes a project worktree, which stands in for a deleted sub-directory
 * of the same project.
 */
export function resolveImportProject(
  recordedDirectory: string | null,
  maps: ImportPathMap[] = [],
  projectWorktree: string | null = null
): ResolvedImportProject {
  if (!recordedDirectory) return { directory: null, via: "unresolved" };
  const map = maps.find((item) => item.from === recordedDirectory);
  if (map) {
    return isDirectory(map.to)
      ? { directory: map.to, via: "mapped" }
      : { directory: null, via: "unresolved" };
  }
  if (isDirectory(recordedDirectory)) return { directory: recordedDirectory, via: "recorded" };
  if (projectWorktree && projectWorktree !== "/" && isDirectory(projectWorktree)) {
    return { directory: projectWorktree, via: "worktree" };
  }
  return { directory: null, via: "unresolved" };
}
