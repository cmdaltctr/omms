import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const seen = new Map<string, string>();

/**
 * This package's version, found by walking up to its `package.json` from source or `dist/`.
 * The first read is kept for the life of the process: `npm i -g` replaces the files of a
 * running copy, and that copy must still report the version of the code it loaded.
 */
export function packageVersion(from = import.meta.url): string {
  let version = seen.get(from);
  if (version === undefined) {
    version = readPackageVersion(from);
    seen.set(from, version);
  }
  return version;
}

function readPackageVersion(from: string): string {
  let dir = dirname(fileURLToPath(from));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "om-memory-system" && pkg.version) return pkg.version;
    } catch {
      /* Try the parent. */
    }
    const parent = dirname(dir);
    if (parent === dir) return "unknown";
    dir = parent;
  }
}
