import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPiSdk, piSdkCandidates, resetPiSdkCache } from "../src/importer/pi-sdk.js";

const dirs: string[] = [];
beforeEach(() => resetPiSdkCache());
afterEach(() => {
  resetPiSdkCache();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeSdk(dir: string, marker: string) {
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      type: "module",
      exports: { ".": { import: "./dist/index.js" } },
    })
  );
  writeFileSync(join(dir, "dist", "index.js"), `export const marker = ${JSON.stringify(marker)};`);
}

const missing = async () => {
  throw new Error("Cannot find package '@earendil-works/pi-coding-agent'");
};
const importUrl = (specifier: string) =>
  specifier.startsWith("file:") ? import(specifier) : missing();

describe("loadPiSdk", () => {
  it("loads Pi's SDK from the managed Pi install when OMMS cannot import it", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-pi-sdk-"));
    dirs.push(home);
    const install = join(home, ".pi", "agent", "install");
    mkdirSync(install, { recursive: true });
    writeFileSync(join(install, "current-version"), "0.99.1\n");
    fakeSdk(
      join(install, "releases", "0.99.1", "node_modules", "@earendil-works", "pi-coding-agent"),
      "managed"
    );
    const sdk = (await loadPiSdk(
      { home, path: "", execPath: "/nowhere/bin/node" },
      importUrl
    )) as unknown as {
      marker: string;
    };
    expect(sdk.marker).toBe("managed");
  });

  it("follows a pi command on PATH to its npm package", async () => {
    const root = mkdtempSync(join(tmpdir(), "omms-pi-sdk-"));
    dirs.push(root);
    const pkg = join(root, "lib", "node_modules", "@earendil-works", "pi-coding-agent");
    fakeSdk(pkg, "global");
    writeFileSync(join(pkg, "dist", "cli.js"), "");
    mkdirSync(join(root, "bin"));
    symlinkSync(join(pkg, "dist", "cli.js"), join(root, "bin", "pi"));
    expect(
      piSdkCandidates({ home: root, path: join(root, "bin"), execPath: "/x/bin/node" })[0]
    ).toContain("pi-coding-agent");
    const sdk = (await loadPiSdk(
      { home: root, path: join(root, "bin"), execPath: "/x/bin/node" },
      importUrl
    )) as unknown as {
      marker: string;
    };
    expect(sdk.marker).toBe("global");
  });

  it("keeps the original error when Pi is not installed anywhere", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-pi-sdk-"));
    dirs.push(home);
    await expect(
      loadPiSdk({ home, path: "", execPath: "/nowhere/bin/node" }, importUrl)
    ).rejects.toThrow("Cannot find package");
  });
});
