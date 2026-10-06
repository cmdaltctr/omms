import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  mergeImportPathMaps,
  parseIgnoredDirectories,
  runPathMaps,
} from "../src/importer/import-path-maps.js";
import { resolveImportProject } from "../src/importer/import-project.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("saved directory maps", () => {
  it("lets a run map win over a saved map with the same source", () => {
    const merged = mergeImportPathMaps(
      [
        { from: "/old", to: "/a" },
        { from: "/keep", to: "/k" },
      ],
      [{ from: "/old", to: "/b" }]
    );
    expect(merged).toEqual([
      { from: "/old", to: "/b" },
      { from: "/keep", to: "/k" },
    ]);
  });

  it("resolves run targets against the working directory and keeps saved maps", async () => {
    const saved = [{ from: "/saved", to: "/s" }];
    const maps = await runPathMaps([{ from: "/old", to: "rel" }], "/work", saved);
    expect(maps).toEqual([
      { from: "/saved", to: "/s" },
      { from: "/old", to: resolve("/work", "rel") },
    ]);
    expect(saved).toEqual([{ from: "/saved", to: "/s" }]);
  });

  it("imports into an existing target and leaves a missing target unresolved", async () => {
    const root = mkdtempSync(join(tmpdir(), "omms-maps-"));
    dirs.push(root);
    const app = join(root, "app");
    mkdirSync(app);
    const maps = await runPathMaps([], root, [
      { from: join(root, "app-feat-x"), to: app },
      { from: join(root, "gone"), to: join(root, "missing") },
    ]);
    expect(resolveImportProject(join(root, "app-feat-x"), maps)).toEqual({
      directory: app,
      via: "mapped",
    });
    expect(resolveImportProject(join(root, "gone"), maps).via).toBe("unresolved");
  });
});

describe("ignored directories", () => {
  it("gives an empty list when the setting is missing", () => {
    expect(parseIgnoredDirectories(undefined)).toEqual([]);
  });

  it("refuses a value that is not a list of absolute paths", () => {
    expect(() => parseIgnoredDirectories("/tmp/x")).toThrow("importIgnoredDirectories");
    expect(() => parseIgnoredDirectories(["relative/dir"])).toThrow("importIgnoredDirectories");
    expect(() => parseIgnoredDirectories([" "])).toThrow("importIgnoredDirectories");
    expect(() => parseIgnoredDirectories([42])).toThrow("importIgnoredDirectories");
  });

  it("expands the home folder and resolves each path", () => {
    expect(parseIgnoredDirectories(["~/scratch", "/a/b/../c/"])).toEqual([
      join(homedir(), "scratch"),
      resolve("/a/c"),
    ]);
  });
});
