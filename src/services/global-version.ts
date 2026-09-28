import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export interface GlobalCommandVersion {
  /** The version the global `om-memory-system --version` printed, or null when not installed. */
  version: string | null;
  path: string | null;
  error?: "timeout" | "failed";
}

type Runner = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean; shell: false }
) => Promise<string>;

const TIMEOUT_MS = 3_000;
const CACHE_MS = 10 * 60_000;

const run: Runner = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { ...options, encoding: "utf8" }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout))
    );
  });

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

/**
 * The command and arguments that print the version without a user-controlled
 * shell. A Windows `.cmd` wrapper can only run through cmd.exe, so it runs
 * through the system's own cmd.exe with fixed arguments.
 */
export function versionInvocation(
  path: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): { file: string; args: string[] } {
  if (platform === "win32" && path.toLowerCase().endsWith(".cmd")) {
    const cmd = env.SystemRoot ? `${env.SystemRoot}\\System32\\cmd.exe` : "cmd.exe";
    return { file: cmd, args: ["/d", "/s", "/c", `"${path}" --version`] };
  }
  return { file: path, args: ["--version"] };
}

let cached: { at: number; value: GlobalCommandVersion } | null = null;

/** Look up the global command's version, at most once every 10 minutes. */
export async function globalCommandVersion(
  options: {
    now?: () => number;
    runner?: Runner;
    find?: () => string | null;
    platform?: NodeJS.Platform;
  } = {}
): Promise<GlobalCommandVersion> {
  const now = (options.now ?? Date.now)();
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const path = (options.find ?? (() => findGlobalCommand()))();
  let value: GlobalCommandVersion;
  if (!path) {
    value = { version: null, path: null };
  } else {
    const { file, args } = versionInvocation(path, options.platform);
    try {
      const output = await (options.runner ?? run)(file, args, {
        timeout: TIMEOUT_MS,
        windowsHide: true,
        shell: false,
      });
      const version = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(output)?.[0] ?? null;
      value = version ? { version, path } : { version: null, path, error: "failed" };
    } catch (error) {
      const killed = (error as { killed?: boolean; signal?: string }).killed;
      value = { version: null, path, error: killed ? "timeout" : "failed" };
    }
  }
  cached = { at: now, value };
  return value;
}

export function resetGlobalVersionCache(): void {
  cached = null;
}
