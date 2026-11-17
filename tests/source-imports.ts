/**
 * One import scanner for the boundary tests. It reads `src/` files as text, so
 * it sees `from`, bare `import`, `import()` and `require()` specifiers alike.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const srcRoot = join(import.meta.dir, "../src");

// Windows paths use `\`. The areas and the checks use `/`.
export const toPosix = (path: string): string => path.split(sep).join("/");

// Any quoted host SDK specifier counts, so string-built specifiers are caught too.
export const HOST_SDK_SPECIFIER = /["'`]@(opencode|opencode-ai|earendil-works)\//;

// `from "x"`, bare `import "x"`, `import("x")`, and `require("x")`.
export const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;

/** Lists the `.ts` files of an area (a `src/`-relative folder or file) as `src/`-relative paths. */
export function tsFiles(area: string): string[] {
  const absolute = join(srcRoot, area);
  if (!statSync(absolute).isDirectory()) return [area];
  const entries = readdirSync(absolute, { recursive: true }) as string[];
  return entries.filter((name) => name.endsWith(".ts")).map((name) => toPosix(join(area, name)));
}

/** Resolves a relative specifier in a `src/` file to the `src/`-relative `.ts` path it loads. */
export function resolveSpecifier(file: string, specifier: string): string {
  const target = relative(srcRoot, resolve(dirname(join(srcRoot, file)), specifier));
  return toPosix(target).replace(/\.js$/, ".ts");
}

/** Resolves each relative import of a `src/` file to the `src/`-relative `.ts` path it loads. */
export function localImports(file: string): string[] {
  const source = readFileSync(join(srcRoot, file), "utf8");
  const targets: string[] = [];
  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[1]!;
    if (specifier.startsWith(".")) targets.push(resolveSpecifier(file, specifier));
  }
  return targets;
}

/** Returns `file -> target` for each import from `fromAreas` into `forbiddenAreas`. */
export function crossings(fromAreas: string[], forbiddenAreas: string[]): string[] {
  const offenders: string[] = [];
  for (const file of fromAreas.flatMap(tsFiles)) {
    for (const target of localImports(file)) {
      const forbidden = forbiddenAreas.some(
        (area) => target === area || target.startsWith(`${area}/`)
      );
      if (forbidden) offenders.push(`src/${file} -> src/${target}`);
    }
  }
  return offenders;
}
