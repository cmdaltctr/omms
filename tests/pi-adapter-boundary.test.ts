import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const piAdapterDir = join(import.meta.dir, "../src/adapters/pi");

function piAdapterFiles(): string[] {
  return readdirSync(piAdapterDir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => join(piAdapterDir, file));
}

// Any quoted host SDK specifier counts, so string-built specifiers are caught too.
const hostSdkSpecifier = /["'`]@(opencode-ai|earendil-works)\//;
const staticHostSdkImport =
  /^\s*(import|export)\s+(?!type\b)[^;]*from\s+["']@(opencode-ai|earendil-works)\//m;
// Importer modules that read host data without the host running (ADR-011).
const importerSdkReaders = new Set([
  "import-readiness.ts",
  "session-loader.ts",
  "settings-models.ts",
]);
// Readers allowed a static SDK import because they are themselves loaded only by import().
const staticSdkReaders = new Set(["session-loader.ts"]);

function tsFiles(dir: string): string[] {
  const entries = readdirSync(join(import.meta.dir, "..", dir), { recursive: true }) as string[];
  return entries.filter((name) => name.endsWith(".ts"));
}

describe("Pi adapter boundary", () => {
  it("imports Pi package types only (no runtime Pi dependency)", () => {
    for (const file of piAdapterFiles()) {
      const source = readFileSync(file, "utf8");
      const runtimeImports = source
        .split("\n")
        .filter((line) => /from\s+["']@earendil-works\//.test(line))
        .filter((line) => !/^\s*import\s+type\b/.test(line));
      expect(runtimeImports).toEqual([]);
    }
  });

  it("keeps host adapters out of the shared core, services, and importer", () => {
    for (const dir of ["src/core", "src/services", "src/types", "src/importer"]) {
      const entries = readdirSync(join(import.meta.dir, "..", dir), {
        recursive: true,
      }) as string[];
      for (const entry of entries.filter((name) => name.endsWith(".ts"))) {
        const source = readFileSync(join(import.meta.dir, "..", dir, entry), "utf8");
        expect(source).not.toContain("adapters/pi");
        expect(source).not.toContain("adapters/opencode");
      }
    }
  });

  it("keeps host SDKs out of every shared core, services, and types file", () => {
    const offenders: string[] = [];
    for (const dir of ["src/core", "src/services", "src/types"]) {
      for (const entry of tsFiles(dir)) {
        const source = readFileSync(join(import.meta.dir, "..", dir, entry), "utf8");
        if (hostSdkSpecifier.test(source)) offenders.push(`${dir}/${entry}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lets the importer load host SDKs only lazily, in named reader modules", () => {
    const offenders: string[] = [];
    for (const entry of tsFiles("src/importer")) {
      const source = readFileSync(join(import.meta.dir, "../src/importer", entry), "utf8");
      if (!hostSdkSpecifier.test(source)) continue;
      const staticImport = staticHostSdkImport.test(source);
      if (!importerSdkReaders.has(entry) || (staticImport && !staticSdkReaders.has(entry))) {
        offenders.push(`src/importer/${entry}`);
      }
    }
    expect(offenders).toEqual([]);

    // A reader with a static SDK import must itself be loaded only by import().
    for (const dir of ["src/core", "src/services", "src/types", "src/importer"]) {
      for (const entry of tsFiles(dir)) {
        const source = readFileSync(join(import.meta.dir, "..", dir, entry), "utf8");
        for (const reader of staticSdkReaders) {
          const name = reader.replace(/\.ts$/, ".js");
          const eager = new RegExp(
            `^\\s*(import|export)\\s+(?!type\\b)[^;]*from\\s+["'][^"']*${name}["']`,
            "m"
          );
          expect(eager.test(source)).toBe(false);
        }
      }
    }
  });

  it("keeps the importer and Pi runtime out of the OpenCode entry points", () => {
    const openCodeEntryPaths = ["src/index.ts", "src/v2/adapter.ts", "src/v2/plugin.ts"];
    for (const relative of openCodeEntryPaths) {
      const source = readFileSync(join(import.meta.dir, "..", relative), "utf8");
      expect(source).not.toContain("importer/");
      expect(source).not.toContain("@earendil-works");
    }

    for (const dir of ["src/core", "src/services", "src/types"]) {
      const entries = readdirSync(join(import.meta.dir, "..", dir), {
        recursive: true,
      }) as string[];
      for (const entry of entries.filter((name) => name.endsWith(".ts"))) {
        const source = readFileSync(join(import.meta.dir, "..", dir, entry), "utf8");
        if (dir === "src/services" && entry === "web-server.ts") {
          const webImports = [
            'import("../importer/web-import-jobs.js")',
            'import("../importer/settings-health.js")',
            'import("../importer/web-import-api.js")',
            'import("../importer/settings-models.js")',
            'import("../importer/claude-hook-api.js")',
          ];
          for (const webImport of webImports) {
            expect(source).toContain(webImport);
          }
          expect(
            webImports.reduce((rest, webImport) => rest.replaceAll(webImport, ""), source)
          ).not.toContain("importer/");
        } else {
          expect(source).not.toContain("importer/");
        }
      }
    }
  });
});
