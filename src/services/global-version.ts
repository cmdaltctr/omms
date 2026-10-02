import { accessSync, constants, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { compareVersions } from "./version-compare.js";

export interface GlobalCommandVersion {
  /** The version in the global install's `package.json`, or null when not installed or unreadable. */
  version: string | null;
  path: string | null;
  error?: "failed";
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The first `om-memory-system` on PATH; on Windows npm installs a `.cmd` wrapper. */
export function findGlobalCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = executable
): string | null {
  const names =
    platform === "win32" ? ["om-memory-system.exe", "om-memory-system.cmd"] : ["om-memory-system"];
  const pathValue = env.PATH ?? env.Path ?? "";
  for (const raw of pathValue.split(platform === "win32" ? ";" : delimiter)) {
    const entry = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!entry || !(platform === "win32" ? /^[A-Za-z]:[\\/]|^\\\\/.test(entry) : isAbsolute(entry)))
      continue;
    for (const name of names) {
      const candidate =
        platform === "win32" ? `${entry.replace(/[\\/]+$/, "")}\\${name}` : join(entry, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** The package folder of the install the command belongs to, or null. */
function packageFolder(command: string, platform: NodeJS.Platform): string | null {
  // npm's Windows layout: the wrapper sits beside node_modules.
  if (platform === "win32") return join(dirname(command), "node_modules", "om-memory-system");
  let dir = dirname(realpathSync(command));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (pkg.name === "om-memory-system") return dir;
    } catch {
      /* Try the parent. */
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The global command's version, read from its install's `package.json`. The
 * command does not run: after a hand-off it would print the newest copy's version.
 */
export function globalCommandVersion(
  options: { find?: () => string | null; platform?: NodeJS.Platform } = {}
): GlobalCommandVersion {
  const path = (options.find ?? (() => findGlobalCommand()))();
  if (!path) return { version: null, path: null };
  try {
    const folder = packageFolder(path, options.platform ?? process.platform);
    if (!folder) return { version: null, path, error: "failed" };
    const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
      name?: string;
      version?: unknown;
    };
    return pkg.name === "om-memory-system" && typeof pkg.version === "string"
      ? { version: pkg.version, path }
      : { version: null, path, error: "failed" };
  } catch {
    return { version: null, path, error: "failed" };
  }
}

export type GlobalRelation = "missing" | "same" | "older" | "newer" | "unknown";

/** How the global install compares with the running OMMS. */
export function globalRelation(running: string, global: string | null): GlobalRelation {
  if (global === null) return "missing";
  const order = compareVersions(global, running);
  if (order === null) return "unknown";
  return order === 0 ? "same" : order < 0 ? "older" : "newer";
}
