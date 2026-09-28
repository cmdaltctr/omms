import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const piAdapterDir = join(import.meta.dir, "../src/adapters/pi");

function piAdapterFiles(): string[] {
  return readdirSync(piAdapterDir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => join(piAdapterDir, file));
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
