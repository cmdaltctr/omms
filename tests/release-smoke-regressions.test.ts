import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const generatedDirs: string[] = [];
const repoRoot = join(import.meta.dir, "..");
const opencodeWebSelectionTest = join(repoRoot, "tests/opencode-web-selection.test.ts");
const packageSkillsTest = join(repoRoot, "tests/package-skills.test.ts");
const piExtensionTest = join(repoRoot, "tests/pi-extension.test.ts");

afterEach(() => {
  for (const dir of generatedDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function runWithPreload(preload: string, test: string, pattern?: string, timeout = 20_000) {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "test",
      "--preload",
      preload,
      ...(pattern ? ["--test-name-pattern", pattern] : []),
      test,
    ],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    timeout,
  });
  // Drain both pipes while the child runs; report its failure before the parent times out.
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
}

it("waits for Pi's background startup and backfill calls instead of a fixed delay", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-pi-start-delay-"));
  generatedDirs.push(dir);
  const preload = join(dir, "pi-start-delay.mjs");
  writeFileSync(
    preload,
    `
import { mock } from "bun:test";
import * as fs from "node:fs";
const originalWriteFileSync = fs.writeFileSync;
function writeFileSync(path, data, options) {
  if (String(path).endsWith("scenario.mjs") && typeof data === "string") {
    for (const call of ["ensureCalls.push(options);", "autostartCalls.push(1);", "backfillCalls.push(input);"]) {
      if (!data.includes(call)) throw new Error("Missing Pi delay injection: " + call);
      data = data.replace(call, "setTimeout(() => { " + call + " }, 50);");
    }
    console.log("PI_START_DELAY_INJECTED");
  }
  return originalWriteFileSync(path, data, options);
}
mock.module("node:fs", () => ({
  ...fs,
  default: { ...fs.default, writeFileSync },
  writeFileSync,
}));
`,
    "utf8"
  );
  const child = Bun.spawnSync({
    cmd: [
      process.execPath,
      "test",
      "--preload",
      preload,
      "--test-name-pattern",
      "reconciles the login item|starts the shared web app|aborts and awaits backfill",
      piExtensionTest,
    ],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  });
  const output = `${child.stdout.toString()}\n${child.stderr.toString()}`;
  expect(output.match(/PI_START_DELAY_INJECTED/g) ?? []).toHaveLength(4);
  expect(child.exitCode, output).toBe(0);
}, 20_000);

it("permits a retired OpenCode snapshot to disappear while a preview reuses its current copy", async () => {
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

  // One 30-second test plus process startup and SQLite cleanup must fit inside the parent.
  const { exitCode, output } = await runWithPreload(
    preload,
    opencodeWebSelectionTest,
    "^pins the session set, holds back newer turns, copies once, and leaves the source unchanged$",
    45_000
  );
  expect(output).toContain("RETIRED_SNAPSHOT_INJECTED");
  expect(exitCode, output).toBe(0);
}, 60_000);

it("allows npm pack enough time to return complete package metadata", async () => {
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

  const { exitCode, output } = await runWithPreload(preload, packageSkillsTest);
  expect(output).toContain("PACKAGE_SKILLS_DELAYED");
  expect(output).toContain("PACKAGE_SKILLS_PACK_INVOKED");
  expect(exitCode, output).toBe(0);
}, 30_000);

it("reports npm pack failure stderr before attempting to parse package metadata", async () => {
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

  const { exitCode, output } = await runWithPreload(preload, packageSkillsTest);
  expect(output).toContain("PACKAGE_SKILLS_FAILURE_INJECTED");
  expect(exitCode, output).not.toBe(0);
  expect(output).toContain("SIMULATED_NPM_PACK_FAILURE");
  expect(output).not.toContain("Unexpected end of JSON input");
});
