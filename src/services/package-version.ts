import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** This package's version, found by walking up to its `package.json` from source or `dist/`. */
export function packageVersion(from = import.meta.url): string {
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
