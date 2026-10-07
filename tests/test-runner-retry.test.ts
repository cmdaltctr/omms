import { afterEach, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scripts/run-tests-isolated.sh runs a failed file once more when
// OMMS_TEST_RETRY is 1. The release smoke sets it on Windows, where a stalled
// runner times out tests that pass on a second run (ADR-024).

const repo = join(import.meta.dir, "..");
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A test file that fails its first `failures` runs, then passes. */
function flakyFile(failures: number) {
  const folder = mkdtempSync(join(tmpdir(), "omms-runner-retry-"));
  folders.push(folder);
  const counter = join(folder, "runs");
  writeFileSync(counter, "0");
  const file = join(folder, "flaky.test.ts");
  writeFileSync(
    file,
    `import { expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
it("fails ${failures} times, then passes", () => {
  const runs = Number(readFileSync(${JSON.stringify(counter)}, "utf8")) + 1;
  writeFileSync(${JSON.stringify(counter)}, String(runs));
  expect(runs).toBeGreaterThan(${failures});
});
`
  );
  return file;
}

function runRunner(file: string, retry: boolean) {
  const env = { ...process.env, OMMS_TEST_RETRY: retry ? "1" : "" };
  delete env.OMMS_TEST_HOME;
  return spawnSync("bash", ["scripts/run-tests-isolated.sh", file], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
}

it("passes a file that fails once when retry is on, and names it", () => {
  const result = runRunner(flakyFile(1), true);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("passed on retry");
}, 60_000);

it("fails a file that fails once when retry is off", () => {
  const result = runRunner(flakyFile(1), false);
  expect(result.status).toBe(1);
}, 60_000);

it("fails a file that fails twice even when retry is on", () => {
  const result = runRunner(flakyFile(2), true);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("test file(s) failed");
}, 60_000);
