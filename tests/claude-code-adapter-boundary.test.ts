import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const srcRoot = join(import.meta.dir, "../src");

// Any quoted host SDK specifier counts, so string-built specifiers are caught too.
const hostSdkSpecifier = /["'`]@(opencode-ai|earendil-works)\//;
// `from "x"`, bare `import "x"`, `import("x")`, and `require("x")`.
const specifierPattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;

// Areas are `src/`-relative folders or files.
const claudeCodeAdapter = ["adapters/claude-code"];
const openCodeHost = ["adapters/opencode", "v2", "index.ts", "plugin.ts"];
const piHost = ["adapters/pi"];
const sharedLayers = ["core", "services", "importer", "types"];

/** Lists the `.ts` files of an area as `src/`-relative paths. */
function tsFiles(area: string): string[] {
  const absolute = join(srcRoot, area);
  if (!statSync(absolute).isDirectory()) return [area];
  const entries = readdirSync(absolute, { recursive: true }) as string[];
  return entries.filter((name) => name.endsWith(".ts")).map((name) => join(area, name));
}

/** Resolves each relative import of a `src/` file to the `src/`-relative `.ts` path it loads. */
function localImports(file: string): string[] {
  const source = readFileSync(join(srcRoot, file), "utf8");
  const targets: string[] = [];
  for (const match of source.matchAll(specifierPattern)) {
    const specifier = match[1]!;
    if (!specifier.startsWith(".")) continue;
    const target = relative(srcRoot, resolve(dirname(join(srcRoot, file)), specifier));
    targets.push(target.replace(/\.js$/, ".ts"));
  }
  return targets;
}

/** Returns `file -> target` for each import from `fromAreas` into `forbiddenAreas`. */
function crossings(fromAreas: string[], forbiddenAreas: string[]): string[] {
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

describe("Claude Code adapter boundary", () => {
  it("resolves the CLI's lazy import of the hook command", () => {
    // Guards the scanner itself: a scan that finds nothing would pass every check below.
    expect(localImports("cli/index.ts")).toContain("adapters/claude-code/hook-command.ts");
  });

  it("keeps the OpenCode and Pi hosts out of the Claude Code adapter", () => {
    expect(crossings(claudeCodeAdapter, [...openCodeHost, ...piHost])).toEqual([]);
  });

  it("keeps host SDKs out of the Claude Code adapter", () => {
    const offenders = tsFiles("adapters/claude-code").filter((file) =>
      hostSdkSpecifier.test(readFileSync(join(srcRoot, file), "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the Claude Code adapter out of the shared core, services, importer, and types", () => {
    expect(crossings(sharedLayers, claudeCodeAdapter)).toEqual([]);
  });

  it("keeps the Claude Code adapter out of the OpenCode and Pi hosts", () => {
    expect(crossings([...openCodeHost, ...piHost], claudeCodeAdapter)).toEqual([]);
  });
});
