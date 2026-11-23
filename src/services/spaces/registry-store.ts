import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
  findSpace,
  linkSpace,
  listSpaces,
  readRegistryFile,
  removeSpace,
  renameSpace,
  switchSpace,
  unarchiveSpace,
  unlinkSpace,
  DEFAULT_SPACE_ID,
  type CreateSpaceOptions,
  type SpaceEntry,
  type SpaceRegistry,
} from "./registry.js";
import { writeSpaceLabel } from "./space-label.js";

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

/** True when the lock text names an owner that is gone, so the next writer may replace it. */
function lockIsStale(lockPath: string, text: string): boolean {
  try {
    const state = JSON.parse(text) as { pid?: unknown };
    return typeof state.pid === "number" && state.pid > 0 && !isProcessAlive(state.pid);
  } catch {
    try {
      return Date.now() - statSync(lockPath).mtimeMs > UNREADABLE_LOCK_GRACE_MS;
    } catch {
      return false;
    }
  }
}

/**
 * Removes the lock only while it still holds the stale text this writer read.
 * Check-then-unlink let a writer delete a fresh lock that another writer had
 * just made. The writer that hard-links the lock to a tombstone named after the
 * stale text is the only one that may remove it, as with the start lock (TDR-094).
 */
function reclaimStaleLock(lockPath: string): void {
  let seen: string;
  try {
    seen = readFileSync(lockPath, "utf-8");
  } catch {
    return; // Gone already: try to take it again.
  }
  if (!lockIsStale(lockPath, seen)) return;
  const tomb = `${lockPath}.${createHash("sha256").update(seen).digest("hex").slice(0, 16)}.stale`;
  try {
    linkSync(lockPath, tomb);
  } catch {
    // Another writer holds the tombstone, or a crashed one left it behind.
    try {
      if (Date.now() - statSync(tomb).mtimeMs > UNREADABLE_LOCK_GRACE_MS) unlinkSync(tomb);
    } catch {
      // No tombstone, or it went meanwhile.
    }
    return;
  }
  try {
    // The lock was replaced after this writer read it: that lock is live.
    if (readFileSync(tomb, "utf-8") === seen) unlinkSync(lockPath);
  } catch {
    // Another writer removed it first.
  } finally {
    try {
      unlinkSync(tomb);
    } catch {
      // Already gone.
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
      const code = (error as NodeJS.ErrnoException).code;
      // Windows keeps a deleted lock "delete pending" while another process
      // still has it open. Creating it then fails with one of these: wait for it.
      const busy = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (code !== "EEXIST" && !busy) throw error;
      if (busy) {
        if (Date.now() > deadline) throw lockTimeout();
        await sleep(LOCK_POLL_MS);
        continue;
      }
    }
    reclaimStaleLock(lockPath);
    if (!existsSync(lockPath)) continue;
    if (Date.now() > deadline) throw lockTimeout();
    await sleep(LOCK_POLL_MS);
  }
}

function lockTimeout(): SpaceError {
  return new SpaceError(
    "lock-timeout",
    "Another OMMS process is changing the space list. Try again in a moment."
  );
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

export async function createStoredSpace(
  files: SpaceFiles,
  name: string,
  options: CreateSpaceOptions = {}
): Promise<SpaceEntry> {
  const { result } = await updateRegistry(files, (registry) => {
    // A leftover folder must not be adopted by a new space, so its name counts as a taken id.
    const folderIds = existsSync(files.spacesRoot) ? readdirSync(files.spacesRoot) : [];
    const created = createSpace(registry, name, new Date().toISOString(), {
      ...options,
      avoidIds: [...(options.avoidIds ?? []), ...folderIds],
    });
    // The folder comes first, so the registry never names a space that has no folder.
    mkdirSync(join(files.spacesRoot, created.space.id), { recursive: true });
    return { registry: created.registry, result: created.space };
  });
  // The label only names the folder; a failed write must not fail the create.
  try {
    writeSpaceLabel(join(files.spacesRoot, result.id), result);
  } catch {
    // Start-up backfills the label later.
  }
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
  name: string,
  options: { defaultFolder?: string } = {}
): Promise<SpaceRegistry> {
  const { registry, result: renamed } = await updateRegistry(files, (current) => {
    // Found by id: the new name may equal another space's id, which findSpace would pick.
    const id = findSpace(current, idOrName)?.id;
    const next = renameSpace(current, idOrName, name);
    return { registry: next, result: listSpaces(next).find((space) => space.id === id) };
  });
  if (renamed) {
    // Default lives in the global storage folder, which only the caller knows.
    const folder =
      renamed.id === DEFAULT_SPACE_ID ? options.defaultFolder : join(files.spacesRoot, renamed.id);
    if (folder) {
      // The label only names the folder; a failed write must not fail the rename.
      try {
        writeSpaceLabel(folder, renamed);
      } catch {
        // Start-up backfills the label later.
      }
    }
  }
  return registry;
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
