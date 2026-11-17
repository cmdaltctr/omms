import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The install check: is an OMMS copy complete enough to start? On 14 November
// two installs wrote the global copy at once and left `js-base64` empty, so the
// web app could not start. `bin/omms-launch.mjs` holds the same logic, because it
// cannot import src/; tests/install-check.test.ts runs both over the same folders.

/** True when a package folder named `name` with a `package.json` resolves from `from`, the way Node.js looks. */
function resolves(from: string, name: string): boolean {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "node_modules", name, "package.json"))) return true;
    if (dirname(dir) === dir) return false;
  }
}

/** The first package folder in `<root>/node_modules` without a `package.json`, or null. */
function emptyPackageFolder(root: string): string | null {
  const modules = join(root, "node_modules");
  let names: string[];
  try {
    names = readdirSync(modules).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if (!name.startsWith("@")) {
      if (!existsSync(join(modules, name, "package.json"))) return name;
      continue;
    }
    let scoped: string[] = [];
    try {
      scoped = readdirSync(join(modules, name)).sort();
    } catch {
      /* A file, not a scope folder. */
    }
    for (const child of scoped)
      if (!existsSync(join(modules, name, child, "package.json"))) return `${name}/${child}`;
  }
  return null;
}

/**
 * The first problem of a copy folder, or null when it is complete: `package.json`
 * unreadable, `dist/cli/index.js` missing, a dependency that does not resolve, or
 * a package folder in its own `node_modules` without a `package.json`. A name is
 * a dependency name or a file name, never a path, so it is safe to log.
 * `optionalDependencies` differ by platform and are skipped.
 */
export function installProblem(root: string): string | null {
  let pkg: {
    dependencies?: Record<string, unknown>;
    optionalDependencies?: Record<string, unknown>;
  };
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    return "package.json";
  }
  if (!existsSync(join(root, "dist", "cli", "index.js"))) return "dist/cli/index.js";
  const optional = pkg.optionalDependencies ?? {};
  for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
    if (!(name in optional) && !resolves(root, name)) return name;
  }
  return emptyPackageFolder(root);
}
