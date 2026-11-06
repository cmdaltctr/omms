import { rmSync } from "node:fs";
import { join } from "node:path";
import { backupSpace } from "./backup.js";
import {
  SpaceError,
  findSpace,
  readRegistryFile,
  removeSpace,
  type SpaceEntry,
} from "./registry.js";
import { removeStoredSpace, type SpaceFiles } from "./registry-store.js";

export interface DeleteDeps {
  /** Replaced in tests only. */
  backup: typeof backupSpace;
  removeFolder(folder: string): void;
}

const defaultDeps: DeleteDeps = {
  backup: backupSpace,
  removeFolder: (folder) => rmSync(folder, { recursive: true, force: false }),
};

export interface DeleteResult {
  backupPath: string;
  space: SpaceEntry;
  /** Set when the registry entry is gone but the folder could not be removed. OMMS does not retry. */
  leftoverFolder?: string;
}

/**
 * Deletes a space (design D8): a verified backup first, then the registry entry, then the folder.
 * The Default space and the active space are refused before anything is copied. Only the web app
 * calls this. The CLI and the `memory` tool have no delete.
 */
export async function deleteSpace(
  files: SpaceFiles,
  idOrName: string,
  options: { ommsVersion: string },
  overrides: Partial<DeleteDeps> = {}
): Promise<DeleteResult> {
  const deps = { ...defaultDeps, ...overrides };
  const { registry, problem } = readRegistryFile(files.registryPath);
  if (problem) throw new SpaceError("unreadable", problem);
  const space = findSpace(registry, idOrName);
  if (!space) removeSpace(registry, idOrName); // throws "unknown" with the list of spaces
  const checked = space!;
  removeSpace(registry, checked.id); // throws when the space is Default or active
  const folder = join(files.spacesRoot, checked.id);
  const { backupPath } = await deps.backup({
    space: checked,
    spaceFolder: folder,
    backupsRoot: files.backupsRoot,
    ommsVersion: options.ommsVersion,
  });
  await removeStoredSpace(files, checked.id);
  try {
    deps.removeFolder(folder);
    return { backupPath, space: checked };
  } catch {
    return { backupPath, space: checked, leftoverFolder: folder };
  }
}
