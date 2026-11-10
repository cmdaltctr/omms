import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");

/** Matches a static or dynamic import of config.js, in any relative form. */
const CONFIG_IMPORT = /(?:from\s+|import\s*\(\s*)["'](?:\.\.?\/)+(?:\.\.\/)*config\.js["']/;

describe("memorisation code takes settings as arguments", () => {
  it.each([
    "src/services/memorisation-store.ts",
    "src/services/memorisation-routes.ts",
    "src/core/memorisation-operations.ts",
    "src/core/memorisation.ts",
  ])("%s does not import CONFIG", (file) => {
    expect(CONFIG_IMPORT.test(source(file)), `${file} imports config.js`).toBe(false);
  });

  it("memory-operations imports memorisation-operations statically", () => {
    const text = source("src/core/memory-operations.ts");
    expect(text).toMatch(/^import .* from "\.\/memorisation-operations\.js";$/m);
    expect(text).not.toMatch(/import\(\s*"\.\/memorisation-operations\.js"\s*\)/);
  });
});
