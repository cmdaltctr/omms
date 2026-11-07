import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  SpaceError,
  archiveSpace,
  createSpace,
  linkSpace,
  readRegistryFile,
  removeSpace,
  renameSpace,
  switchSpace,
  unarchiveSpace,
  unlinkSpace,
  type SpaceEntry,
  type SpaceRegistry,
} from "./registry.js";

/**
 * The one write path for `spaces.json` (design D5). The web server, the CLI and the
 * `memory` tool all change the registry through `updateRegistry`. Readers never lock.
 *
 * A change runs as: take the lock file, read the file, apply the change, write a
 * temporary file, rename it over `spaces.json`, release the lock. A reader sees
 * the old file or the new file, never a part of one.
 */

const LOCK_TIMEOUT_MS = 5000;
const LOCK_POLL_MS = 15;
/** A lock file with no readable owner is stale only after this long, so a lock still being written is kept. */
const UNREADABLE_LOCK_GRACE_MS = 2000;

export interface SpaceFiles {
  /** `<omms folder>/spaces.json` */
  registryPath: string;
  lockPath: string;
  /** `<omms folder>/spaces`: one folder per extra space. */
  spacesRoot: string;
  /** `<omms folder>/backups` */
  backupsRoot: string;
  /** `<omms folder>/space-appearance`: the icon of each space. It is outside every space folder. */
  appearanceRoot: string;
}

/** Locations of the registry and space folders under the OMMS folder (normally `~/.omms`). */
export function spaceFiles(ommsDir: string): SpaceFiles {
  return {
    registryPath: join(ommsDir, "spaces.json"),
    lockPath: join(ommsDir, "spaces.json.lock"),
    spacesRoot: join(ommsDir, "spaces"),
    backupsRoot: join(ommsDir, "backups"),
    appearanceRoot: join(ommsDir, "space-appearance"),
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True when the lock file exists but its owner is gone, so the next writer may remove it. */
function lockIsStale(lockPath: string): boolean {
  try {
    const state = JSON.parse(readFileSync(lockPath, "utf-8")) as { pid?: unknown };
    return typeof state.pid === "number" && state.pid > 0 && !isProcessAlive(state.pid);
  } catch {
    try {
      return Date.now() - statSync(lockPath).mtimeMs > UNREADABLE_LOCK_GRACE_MS;
    } catch {
      return false;
    }
  }
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function acquireLock(lockPath: string): Promise<void> {
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (lockIsStale(lockPath)) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Another writer removed it first. Try to take it again.
      }
      continue;
    }
    if (Date.now() > deadline) {
      throw new SpaceError(
        "lock-timeout",
        "Another OMMS process is changing the space list. Try again in a moment."
      );
    }
    await sleep(LOCK_POLL_MS);
  }
}

/**
 * Applies `change` to the registry under the lock and writes the result.
 * A registry file that cannot be read is never overwritten: the caller must fix it first.
 * When `change` throws, the file is left as it was.
 */
export async function updateRegistry<T>(
  files: SpaceFiles,
  change: (registry: SpaceRegistry) => { registry: SpaceRegistry; result: T }
): Promise<{ registry: SpaceRegistry; result: T }> {
  await acquireLock(files.lockPath);
  try {
    const current = readRegistryFile(files.registryPath);
    if (current.problem) {
      throw new SpaceError(
        "unreadable",
        `${current.problem} Fix or remove ${files.registryPath} before changing spaces.`
      );
    }
    const next = change(current.registry);
    const temporary = `${files.registryPath}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(next.registry, null, 2)}\n`);
      renameSync(temporary, files.registryPath);
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
    return next;
  } finally {
    try {
      unlinkSync(files.lockPath);
    } catch {
      // The lock is already gone.
    }
  }
}

export async function createStoredSpace(files: SpaceFiles, name: string): Promise<SpaceEntry> {
  const { result } = await updateRegistry(files, (registry) => {
    const created = createSpace(registry, name, new Date().toISOString());
    // The folder comes first, so the registry never names a space that has no folder.
    mkdirSync(join(files.spacesRoot, created.space.id), { recursive: true });
    return { registry: created.registry, result: created.space };
  });
  return result;
}

const simple =
  (apply: (registry: SpaceRegistry, idOrName: string) => SpaceRegistry) =>
  async (files: SpaceFiles, idOrName: string): Promise<SpaceRegistry> =>
    (
      await updateRegistry(files, (registry) => ({
        registry: apply(registry, idOrName),
        result: 0,
      }))
    ).registry;

export const archiveStoredSpace = simple(archiveSpace);
export const unarchiveStoredSpace = simple(unarchiveSpace);
export const switchStoredSpace = simple(switchSpace);
export const removeStoredSpace = simple(removeSpace);

export async function renameStoredSpace(
  files: SpaceFiles,
  idOrName: string,
  name: string
): Promise<SpaceRegistry> {
  return (
    await updateRegistry(files, (registry) => ({
      registry: renameSpace(registry, idOrName, name),
      result: 0,
    }))
  ).registry;
}

/** Adds a link between two stored spaces under the lock (design D5). */
export async function linkStoredSpace(
  files: SpaceFiles,
  idOrName: string,
  targetIdOrName: string
): Promise<SpaceRegistry> {
  return (
    await updateRegistry(files, (registry) => ({
      registry: linkSpace(registry, idOrName, targetIdOrName),
      result: 0,
    }))
  ).registry;
}

/** Removes a link between two stored spaces under the lock (design D5). */
export async function unlinkStoredSpace(
  files: SpaceFiles,
  idOrName: string,
  targetIdOrName: string
): Promise<SpaceRegistry> {
  return (
    await updateRegistry(files, (registry) => ({
      registry: unlinkSpace(registry, idOrName, targetIdOrName),
      result: 0,
    }))
  ).registry;
}
