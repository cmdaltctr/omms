import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

export type PiSdk = typeof import("@earendil-works/pi-coding-agent");

const PACKAGE = "@earendil-works/pi-coding-agent";

export interface PiSdkLocations {
  home: string;
  path: string;
  execPath: string;
}

function packageEntry(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name?: string;
      main?: string;
      exports?: Record<string, unknown>;
    };
    if (pkg.name !== PACKAGE) return null;
    const root = pkg.exports?.["."] as { import?: string; default?: string } | string | undefined;
    const entry = (typeof root === "string" ? root : (root?.import ?? root?.default)) ?? pkg.main;
    return entry ? join(dir, entry) : null;
  } catch {
    return null;
  }
}

/**
 * Folders that may hold Pi's own SDK when OMMS runs outside Pi, for example in
 * the login web app: Pi's managed install, then each `pi` on `PATH`, then the
 * global `node_modules` of the running Node.
 */
export function piSdkCandidates(locations: PiSdkLocations): string[] {
  const dirs: string[] = [];
  const agent = join(locations.home, ".pi", "agent");
  try {
    const version = readFileSync(join(agent, "install", "current-version"), "utf8").trim();
    if (/^[\w.+-]+$/.test(version) && version !== "." && version !== "..") {
      dirs.push(join(agent, "install", "releases", version, "node_modules", PACKAGE));
    }
  } catch {
    // No managed Pi install.
  }
  for (const entry of locations.path.split(delimiter)) {
    if (!entry || !isAbsolute(entry)) continue;
    const bin = join(entry, "pi");
    if (!existsSync(bin)) continue;
    // An npm install links `pi` to a file inside the package: walk up to it.
    let dir: string;
    try {
      dir = dirname(realpathSync(bin));
    } catch {
      continue;
    }
    for (let i = 0; i < 6 && dirname(dir) !== dir; i++, dir = dirname(dir)) {
      if (existsSync(join(dir, "package.json"))) {
        dirs.push(dir);
        break;
      }
    }
    dirs.push(join(dirname(entry), "lib", "node_modules", PACKAGE));
  }
  dirs.push(join(dirname(dirname(locations.execPath)), "lib", "node_modules", PACKAGE));
  return [...new Set(dirs)];
}

let cached: Promise<PiSdk> | null = null;

/**
 * Load Pi's SDK: from OMMS's own dependencies when Pi installed OMMS, otherwise
 * from where Pi itself is installed.
 */
export function loadPiSdk(
  locations: PiSdkLocations = {
    home: homedir(),
    path: process.env.PATH ?? "",
    execPath: process.execPath,
  },
  importer: (specifier: string) => Promise<unknown> = (specifier) => import(specifier)
): Promise<PiSdk> {
  if (cached) return cached;
  const attempt = (async () => {
    try {
      return (await importer(PACKAGE)) as PiSdk;
    } catch (first) {
      for (const dir of piSdkCandidates(locations)) {
        const entry = packageEntry(dir);
        if (entry && existsSync(entry)) return (await importer(pathToFileURL(entry).href)) as PiSdk;
      }
      throw first;
    }
  })();
  cached = attempt;
  attempt.catch(() => {
    if (cached === attempt) cached = null;
  });
  return attempt;
}

/** Tests only: forget the loaded SDK. */
export function resetPiSdkCache(): void {
  cached = null;
}
