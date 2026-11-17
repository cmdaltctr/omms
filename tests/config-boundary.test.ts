import { describe, expect, it } from "bun:test";
import { crossings, localImports } from "./source-imports.js";

// Loading config must load no importer code: many processes read config, and
// the importer pulls in history readers. Config parsers live in `src/utils/`.
describe("config boundary", () => {
  it("scans the imports of src/config.ts", () => {
    // Guard: an empty scan would pass the check below for the wrong reason.
    expect(localImports("config.ts")).toContain("utils/backfill-model.ts");
  });

  it("src/config.ts imports nothing from src/importer/", () => {
    expect(crossings(["config.ts"], ["importer"])).toEqual([]);
  });
});
