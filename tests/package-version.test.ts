import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { packageVersion } from "../src/services/package-version.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A package folder with a module file inside `dist/`. Returns the module's URL. */
function makePackage(version: string): { root: string; module: string } {
  const root = mkdtempSync(join(tmpdir(), "omms-package-version-"));
  dirs.push(root);
  mkdirSync(join(root, "dist", "services"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "om-memory-system", version }));
  return { root, module: pathToFileURL(join(root, "dist", "services", "x.js")).href };
}

describe("packageVersion", () => {
  it("finds the version in the nearest om-memory-system package.json", () => {
    expect(packageVersion(makePackage("4.3.2").module)).toBe("4.3.2");
  });

  it("keeps the version it first read after the package is updated in place", () => {
    // A running web app keeps its loaded code after `npm i -g` replaces the files.
    // It must keep its own version, so a newer copy can see that it is older and replace it.
    const { root, module } = makePackage("4.3.0");
    expect(packageVersion(module)).toBe("4.3.0");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "om-memory-system", version: "4.3.2" })
    );
    expect(packageVersion(module)).toBe("4.3.0");
  });
});
