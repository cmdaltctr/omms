import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { compareVersions } from "./version-compare.js";

// The newest-copy record: `~/.omms/runtime.json` names the newest valid OMMS copy
// on the machine. This module takes the `~/.omms` folder as an argument and
// imports no config, so tests need no real home folder and `config.ts` stubs do
// not matter.

export interface RuntimeRecord {
  root: string;
  version: string;
  updatedAt: string;
}

/** A valid copy: its package folder and the version in its `package.json`. */
export interface RuntimeCopy {
  root: string;
  version: string;
}

/** A log call carries a code and identifiers only, never a path or file text. */
export type RuntimeLog = (code: string, data: Record<string, unknown>) => void;

export type RegisterResult = "written" | "kept" | "skipped" | "failed";

export const recordPath = (dir: string): string => join(dir, "runtime.json");
export const launcherPath = (dir: string): string => join(dir, "bin", "omms-launch.mjs");

/**
 * The version of a valid OMMS copy, or null. A copy is valid when its
 * `package.json` names `om-memory-system`, its version can be compared, and it
 * has `dist/cli/index.js`.
 */
export function copyVersion(root: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    if (pkg.name !== "om-memory-system" || typeof pkg.version !== "string") return null;
    if (compareVersions(pkg.version, pkg.version) === null) return null;
    return existsSync(join(root, "dist", "cli", "index.js")) ? pkg.version : null;
  } catch {
    return null;
  }
}

/** The record as written, or null. A missing record is normal; any other failure logs a code. */
export function readRuntimeRecord(dir: string, log?: RuntimeLog): RuntimeRecord | null {
  let text: string;
  try {
    text = readFileSync(recordPath(dir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      log?.("runtime-record-read-failed", { reason: "read" });
    return null;
  }
  try {
    const value = JSON.parse(text) as Partial<RuntimeRecord> | null;
    if (
      !value ||
      typeof value.root !== "string" ||
      typeof value.version !== "string" ||
      typeof value.updatedAt !== "string"
    )
      throw new Error("shape");
    return { root: value.root, version: value.version, updatedAt: value.updatedAt };
  } catch {
    log?.("runtime-record-read-failed", { reason: "parse" });
    return null;
  }
}

/** The copy the record names, when it is still valid. The version is read from its `package.json`. */
export function recordedCopy(dir: string, log?: RuntimeLog): RuntimeCopy | null {
  const record = readRuntimeRecord(dir, log);
  if (!record) return null;
  const version = copyVersion(record.root);
  return version ? { root: record.root, version } : null;
}

/** Write a file in one step, so a reader never finds a partial file. */
function writeAtomic(path: string, write: (temp: string) => void): void {
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    write(temp);
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

function sameFile(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

/** Put the copy's launcher at the fixed path when it is missing or different. */
function placeLauncher(dir: string, root: string, log?: RuntimeLog): void {
  const source = join(root, "bin", "omms-launch.mjs");
  if (!existsSync(source)) return;
  const target = launcherPath(dir);
  if (sameFile(source, target)) return;
  try {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeAtomic(target, (temp) => copyFileSync(source, temp));
  } catch {
    log?.("runtime-launcher-write-failed", {});
  }
}

/**
 * Record this copy when the record is missing, names a copy that is no longer
 * valid, or names an older version. An equal version keeps the record. The copy
 * that holds the record also keeps the launcher at `~/.omms/bin`. A failure is
 * logged with a code and never thrown.
 */
export function registerCopy(options: {
  dir: string;
  root: string;
  log?: RuntimeLog;
  now?: () => Date;
}): RegisterResult {
  const { dir, root, log } = options;
  const own = copyVersion(root);
  if (!own) return "skipped";
  try {
    const current = recordedCopy(dir, log);
    const newer = !current || (compareVersions(own, current.version) ?? 0) > 0;
    if (!newer) {
      // The recorded copy owns the launcher, so it repairs a missing or damaged one.
      if (current?.root === root) placeLauncher(dir, root, log);
      return "kept";
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const record: RuntimeRecord = {
      root,
      version: own,
      updatedAt: (options.now?.() ?? new Date()).toISOString(),
    };
    writeAtomic(recordPath(dir), (temp) =>
      writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    );
    placeLauncher(dir, root, log);
    return "written";
  } catch {
    log?.("runtime-record-write-failed", {});
    return "failed";
  }
}
