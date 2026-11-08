import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  listSpaces,
  readRegistryFile,
  resolveSpaceFolder,
  type SpaceEntry,
  type SpaceRegistry,
} from "./registry.js";

/**
 * The `space.json` label inside every space folder (space-folder-ids design). It
 * names a folder found on disk. OMMS writes it but never reads it to decide
 * anything: the registry stays the only source for ids, names and folders.
 */

const LABEL_FILE = "space.json";

/** Writes the label of one space folder atomically: temp file in the folder, then rename. */
export function writeSpaceLabel(folder: string, space: SpaceEntry): void {
  const target = join(folder, LABEL_FILE);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(spaceLabelOf(space), null, 2)}\n`);
    renameSync(temporary, target);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function spaceLabelOf(space: SpaceEntry): { id: string; name: string; createdAt: string } {
  // The Default space has no creation time in the registry, so its label keeps the empty string.
  return { id: space.id, name: space.name, createdAt: space.createdAt };
}

/** The name in the folder label, or undefined when the file is missing or broken. */
function labelName(folder: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(folder, LABEL_FILE), "utf-8")) as {
      name?: unknown;
    };
    return typeof raw?.name === "string" ? raw.name : undefined;
  } catch {
    // A missing or broken label is rewritten, never trusted.
    return undefined;
  }
}

/**
 * Adds or repairs the label of every existing space folder. A folder that does
 * not exist is skipped: the pass never creates a folder and touches no other
 * file. One failing folder does not stop the rest.
 */
export function backfillSpaceLabels(
  registry: SpaceRegistry,
  files: { spacesRoot: string },
  globalStoragePath: string
): void {
  for (const space of listSpaces(registry)) {
    try {
      const folder = resolveSpaceFolder(space.id, {
        globalStoragePath,
        spacesRoot: files.spacesRoot,
      });
      if (!existsSync(folder)) continue;
      if (labelName(folder) === space.name) continue;
      writeSpaceLabel(folder, space);
    } catch {
      // The label is metadata; the registry entry is what counts.
    }
  }
}

/**
 * Reads the registry from the OMMS folder and runs the backfill pass over it.
 * Best effort: callers wrap it so a failure never reaches start-up.
 */
export function backfillSpaceLabelsFromDisk(ommsDir: string, globalStoragePath: string): void {
  const { registry } = readRegistryFile(join(ommsDir, "spaces.json"));
  backfillSpaceLabels(registry, { spacesRoot: join(ommsDir, "spaces") }, globalStoragePath);
}
