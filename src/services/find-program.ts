import { statSync } from "node:fs";
import { posix, win32 } from "node:path";

/** Every input comes from the caller, so a test can search a scratch `PATH` and nothing else. */
export interface FindProgramDeps {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  /** True for a file. Defaults to a real file-system check. */
  isFile?: (path: string) => boolean;
}

function defaultIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function envValue(env: FindProgramDeps["env"], platform: NodeJS.Platform, name: string) {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((entry) => entry.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * Finds a program by name: the `PATH` folders first, then `extraFolders`.
 * On Windows each `PATHEXT` extension is tried. It looks in no other folder.
 */
export function findProgram(
  name: string,
  extraFolders: string[],
  deps: FindProgramDeps
): string | null {
  const windows = deps.platform === "win32";
  const path = windows ? win32 : posix;
  const isFile = deps.isFile ?? defaultIsFile;
  const pathFolders = (envValue(deps.env, deps.platform, "PATH") ?? "")
    .split(windows ? ";" : ":")
    .map((folder) => folder.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  const extensions = windows
    ? (envValue(deps.env, deps.platform, "PATHEXT") ?? ".com;.exe;.bat;.cmd")
        .split(";")
        .filter(Boolean)
    : [""];
  for (const folder of [...pathFolders, ...extraFolders]) {
    for (const extension of extensions) {
      const candidate = path.join(folder, `${name}${extension}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}
