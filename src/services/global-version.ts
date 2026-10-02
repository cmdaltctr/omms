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
 * Where a global npm install can be for a Node.js binary, the same places the
 * launcher looks. Homebrew runs Node from a versioned `Cellar/node/<version>`
 * folder, but npm installs under the prefix above `Cellar`.
 */
function installsBesideRuntime(execPath: string, platform: NodeJS.Platform): string[] {
  if (!execPath) return [];
  if (platform === "win32") return [join(dirname(execPath), "node_modules", "om-memory-system")];
  const direct = join(dirname(dirname(execPath)), "lib", "node_modules", "om-memory-system");
  const brew = /^(.*)[\\/]Cellar[\\/][^\\/]+[\\/][^\\/]+[\\/]bin[\\/][^\\/]+$/.exec(execPath);
  return brew ? [direct, join(brew[1]!, "lib", "node_modules", "om-memory-system")] : [direct];
}

/** The version in an install's `package.json`, or null when it is not an OMMS install. */
function installVersion(folder: string): string | null {
  const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
    name?: string;
    version?: unknown;
  };
  return pkg.name === "om-memory-system" && typeof pkg.version === "string" ? pkg.version : null;
}

/**
 * The global command's version, read from its install's `package.json`. The
 * command does not run: after a hand-off it would print the newest copy's version.
 * The login item runs with a minimal PATH, so with no command on PATH the install
 * beside the running Node.js counts too.
 */
export function globalCommandVersion(
  options: { find?: () => string | null; platform?: NodeJS.Platform; execPath?: string } = {}
): GlobalCommandVersion {
  const platform = options.platform ?? process.platform;
  const path = (options.find ?? (() => findGlobalCommand()))();
  if (!path) {
    for (const folder of installsBesideRuntime(options.execPath ?? process.execPath, platform)) {
      try {
        const version = installVersion(folder);
        if (version) return { version, path: folder };
      } catch {
        /* No install there. */
      }
    }
    return { version: null, path: null };
  }
  try {
    const folder = packageFolder(path, platform);
    const version = folder ? installVersion(folder) : null;
    return version ? { version, path } : { version: null, path, error: "failed" };
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
