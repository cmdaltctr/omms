import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const generatedDirs: string[] = [];
const repoRoot = join(import.meta.dir, "..");
const opencodeWebSelectionTest = join(repoRoot, "tests/opencode-web-selection.test.ts");
const packageSkillsTest = join(repoRoot, "tests/package-skills.test.ts");

afterEach(() => {
  for (const dir of generatedDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runWithPreload(preload: string, test: string) {
  const child = Bun.spawnSync({
    cmd: [process.execPath, "test", "--preload", preload, test],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { child, output: `${child.stdout.toString()}\n${child.stderr.toString()}` };
}

it("permits a retired OpenCode snapshot to disappear while a preview reuses its current copy", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-retired-snapshot-preload-"));
  generatedDirs.push(dir);
  const preload = join(dir, "retired-snapshot-preload.mjs");

  writeFileSync(
    preload,
    `
import { mock } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const retired = "omms-opencode-retired-regression";
const realReaddirSync = fs.readdirSync;
const realReadFileSync = fs.readFileSync;
let ownedSnapshotReads = 0;

function readdirSync(path, options) {
  const entries = realReaddirSync(path, options);
  const stack = new Error().stack ?? "";
  if (String(path) !== tmpdir() || !stack.includes("ownedSnapshots")) return entries;
  ownedSnapshotReads++;
  if (ownedSnapshotReads !== 2) return entries;
  console.log("RETIRED_SNAPSHOT_INJECTED");
  return [...entries, retired];
}

function readFileSync(path, options) {
  if (String(path) === join(tmpdir(), retired, "owner.json")) {
    return JSON.stringify({ pid: process.pid });
  }
  return realReadFileSync(path, options);
}

mock.module("node:fs", () => ({
  ...fs,
  default: { ...fs.default, readdirSync, readFileSync },
  readdirSync,
  readFileSync,
}));
`,
    "utf8"
  );

  const { child, output } = runWithPreload(preload, opencodeWebSelectionTest);
  expect(output).toContain("RETIRED_SNAPSHOT_INJECTED");
  expect(child.exitCode, output).toBe(0);
}, 30_000);

it("allows npm pack enough time to return complete package metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-package-skills-delay-preload-"));
  generatedDirs.push(dir);
  const preload = join(dir, "package-skills-delay-preload.mjs");

  writeFileSync(
    preload,
    `
const originalSpawnSync = Bun.spawnSync;

Bun.spawnSync = (command, options) => {
  if (!Array.isArray(command) || command[0] !== "npm" || command[1] !== "pack") {
    return originalSpawnSync(command, options);
  }
  console.log("PACKAGE_SKILLS_DELAYED");
  originalSpawnSync([process.execPath, "-e", "await Bun.sleep(6000)"]);
  console.log("PACKAGE_SKILLS_PACK_INVOKED");
  return originalSpawnSync(command, options);
};
`,
    "utf8"
  );

  const { child, output } = runWithPreload(preload, packageSkillsTest);
  expect(output).toContain("PACKAGE_SKILLS_DELAYED");
  expect(output).toContain("PACKAGE_SKILLS_PACK_INVOKED");
  expect(child.exitCode, output).toBe(0);
}, 30_000);

it("reports npm pack failure stderr before attempting to parse package metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-package-skills-failure-preload-"));
  generatedDirs.push(dir);
  const preload = join(dir, "package-skills-failure-preload.mjs");

  writeFileSync(
    preload,
    `
import { Buffer } from "node:buffer";

const originalSpawnSync = Bun.spawnSync;

Bun.spawnSync = (command, options) => {
  if (!Array.isArray(command) || command[0] !== "npm" || command[1] !== "pack") {
    return originalSpawnSync(command, options);
  }
  console.log("PACKAGE_SKILLS_FAILURE_INJECTED");
  return {
    exitCode: 1,
    stdout: Buffer.from(""),
    stderr: Buffer.from("SIMULATED_NPM_PACK_FAILURE"),
  };
};
`,
    "utf8"
  );

  const { child, output } = runWithPreload(preload, packageSkillsTest);
  expect(output).toContain("PACKAGE_SKILLS_FAILURE_INJECTED");
  expect(child.exitCode, output).not.toBe(0);
  expect(output).toContain("SIMULATED_NPM_PACK_FAILURE");
  expect(output).not.toContain("Unexpected end of JSON input");
});
