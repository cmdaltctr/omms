import { readdirSync, readFileSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { isOlderVersion } from "./version-compare.js";

// OpenCode 2.2 installs each update of a plugin to a new folder:
// `<cache>/om-memory-system@latest/<ms timestamp>/node_modules/om-memory-system/`.
// It never removes the old ones. This module lists the copies next to the
// running one, so the update check can see whether the new version reached the
// disk and the OpenCode service can remove copies that no process needs.
// It takes paths as arguments and imports no config, so tests need no real home.

/** The clean-up leaves everything alone until the running copy is this old. */
export const CACHE_PRUNE_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const PACKAGE_FOLDER = "/node_modules/om-memory-system";

export interface HostCopy {
  /** The package folder: `.../node_modules/om-memory-system`. */
  root: string;
  /** The `version` in its `package.json`, or null when that cannot be read. */
  version: string | null;
  /** The timestamp folder name as a number (install time in ms since 1970). */
  stamp: number;
}

export interface HostCopies {
  root: string;
  version: string | null;
  /** The running copy's timestamp, or null when its folder is not a timestamp folder. */
  stamp: number | null;
  /** Every other timestamp folder in the same cache folder. Empty without a timestamp. */
  siblings: HostCopy[];
}

function versionAt(root: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/** The same path with one separator and no trailing one, for comparing roots. */
const samePath = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "");

/**
 * A key that is equal for two paths to the same folder. The device and inode
 * match through a symbolic link or a different letter case; a path that cannot
 * be read falls back to its text.
 */
function folderKey(path: string): string {
  try {
    const { dev, ino } = statSync(path);
    if (ino !== 0) return `inode:${dev}:${ino}`;
  } catch {
    // Compare the text below.
  }
  return `path:${samePath(path)}`;
}

/**
 * The running copy and, when it sits in a timestamp folder, the other copies in
 * the same cache folder. Null when `modulePath` is not inside
 * `node_modules/om-memory-system/`. Never throws.
 */
export function listHostCopies(modulePath: string): HostCopies | null {
  const normal = modulePath.replaceAll("\\", "/");
  const at = normal.lastIndexOf(`${PACKAGE_FOLDER}/`);
  if (at < 0) return null;
  // Replacing a backslash with a slash keeps the length, so the index fits the original path.
  const root = modulePath.slice(0, at + PACKAGE_FOLDER.length);
  const stampFolder = modulePath.slice(0, at);
  const parts = stampFolder.replaceAll("\\", "/").split("/");
  const name = parts[parts.length - 1] ?? "";
  const result: HostCopies = { root, version: versionAt(root), stamp: null, siblings: [] };
  if (!/^\d+$/.test(name)) return result;
  result.stamp = Number(name);
  const cache = stampFolder.slice(0, stampFolder.length - name.length);
  try {
    const names = readdirSync(cache, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name) && entry.name !== name)
      .map((entry) => entry.name)
      .sort((a, b) => Number(a) - Number(b));
    for (const sibling of names) {
      const siblingRoot = join(cache, sibling, "node_modules", "om-memory-system");
      result.siblings.push({
        root: siblingRoot,
        version: versionAt(siblingRoot),
        stamp: Number(sibling),
      });
    }
  } catch {
    // An unreadable cache folder lists no siblings.
  }
  return result;
}

/**
 * The versions on disk: the running copy's and each sibling's. Pi updates in
 * place, so its running copy shows the new version after `pi update`. OpenCode
 * shows it in a new sibling folder. Never throws.
 */
export function installedVersions(modulePath: string): string[] {
  const copies = listHostCopies(modulePath);
  if (!copies) return [];
  const versions = [copies.version, ...copies.siblings.map((copy) => copy.version)];
  return versions.filter((version): version is string => version !== null);
}

export interface PruneOptions {
  modulePath: string;
  runningVersion: string;
  /** Package folders that must stay, such as the copy `~/.omms/runtime.json` records. */
  keepRoots: string[];
  now: number;
  /** Removes a folder and everything in it. Defaults to an asynchronous `rm`, so a large folder does not block the service. */
  remove?: (folder: string) => void | Promise<void>;
  log: (message: string, data: Record<string, unknown>) => void | Promise<void>;
}

/**
 * Remove old OMMS copies from the running copy's cache folder. A copy goes only
 * when its timestamp and its version are both older than the running copy's,
 * it is not in `keepRoots`, and the running copy is at least
 * `CACHE_PRUNE_MIN_AGE_MS` old. A copy that cannot be removed stays. Logs one
 * `OpenCode cache clean-up` record with counts when an older copy was
 * considered, so a pass with nothing to do stays silent. Never throws.
 */
export async function pruneOldCacheCopies(
  options: PruneOptions
): Promise<{ removed: number; kept: number }> {
  const counts = { removed: 0, kept: 0 };
  try {
    const copies = listHostCopies(options.modulePath);
    if (!copies || copies.stamp === null) return counts;
    const older = copies.siblings.filter((copy) => copy.stamp < copies.stamp!);
    if (older.length === 0) return counts;
    const keep = new Set(options.keepRoots.map(folderKey));
    const old = options.now - copies.stamp >= CACHE_PRUNE_MIN_AGE_MS;
    const remove = options.remove ?? ((folder) => rm(folder, { recursive: true, force: true }));
    for (const copy of older) {
      const removable =
        old &&
        copy.version !== null &&
        isOlderVersion(copy.version, options.runningVersion) &&
        !keep.has(folderKey(copy.root));
      if (removable) {
        try {
          // The timestamp folder holds the whole install, not only the package folder.
          await remove(join(copy.root, "..", ".."));
          counts.removed++;
          continue;
        } catch {
          // A locked or busy folder stays.
        }
      }
      counts.kept++;
    }
    try {
      void Promise.resolve(options.log("OpenCode cache clean-up", { ...counts })).catch(() => {});
    } catch {
      // A failed log write must not change the result.
    }
  } catch {
    // The clean-up is housekeeping. It never breaks the service.
  }
  return counts;
}
