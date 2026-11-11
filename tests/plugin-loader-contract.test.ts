/**
 * Regression guard: the package loads as an OpenCode V2 plugin only. OpenCode V1
 * reads a `server` entry, so the package must not offer one.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

function readPackageJson(): Record<string, unknown> {
  const raw = readFileSync(new URL("../package.json", import.meta.url), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function loadDistPlugin(): Promise<unknown> {
  const modUrl = new URL("../dist/plugin.js", import.meta.url).href;
  return import(modUrl);
}

describe("OpenCode V2 plugin-loader contract", () => {
  it("dist shard manager avoids CommonJS fs require in ESM output", () => {
    const source = readFileSync(
      new URL("../dist/services/turso/shard-manager.js", import.meta.url),
      "utf-8"
    );

    expect(source).not.toMatch(/require\s*\(\s*["']node:fs["']\s*\)/);
  });

  it('package.json has no exports["./server"] field', () => {
    const pkg = readPackageJson();
    const exports = pkg["exports"] as Record<string, unknown> | undefined;
    expect(exports).toBeDefined();
    expect(exports?.["./server"]).toBeUndefined();
  });

  it("dist/plugin.js default export is a PluginModule object", async () => {
    const mod = (await loadDistPlugin()) as { default: unknown };
    expect(typeof mod.default).toBe("object");
  });

  it('dist/plugin.js default export has no "server" property and a V2 setup', async () => {
    const mod = (await loadDistPlugin()) as { default: unknown };
    const defaultExport = mod.default as Record<string, unknown> | null | undefined;
    expect(defaultExport && "server" in defaultExport).toBe(false);
    expect(typeof defaultExport?.["setup"]).toBe("function");
  });

  // OpenCode only requires a non-empty string id (the package name is merely the
  // fallback when id is absent). omms keeps a fixed id so a package rename
  // never changes the plugin's storage scope or enable/disable selector.
  it('dist/plugin.js default export has the stable "omms" id', async () => {
    const mod = (await loadDistPlugin()) as { default: unknown };
    const defaultExport = mod.default as Record<string, unknown> | null | undefined;

    expect(defaultExport?.["id"]).toBe("omms");
  });
});
