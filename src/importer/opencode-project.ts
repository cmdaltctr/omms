import type { ImportPathMap } from "./importer.js";
import { resolveImportProject } from "./import-project.js";

/** A directory map first, then the recorded directory, then the project root. */
export function resolveOpencodeProject(
  recordedDirectory: string,
  projectWorktree: string | null,
  maps: ImportPathMap[] = []
): string | null {
  return resolveImportProject(recordedDirectory, maps, projectWorktree).directory;
}

export interface UnresolvedProject {
  directory: string;
  sessions: number;
  units: number;
}
