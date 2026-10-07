import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// scripts/run-tests-isolated.sh gives each run an empty home folder, so tests
// never open the developer's real ~/.omms store. Bun reads the home folder once
// at process start, so only the runner can set it. tests/preload.ts enforces it.
it("runs with the runner's empty home folder", async () => {
  const testHome = process.env.OMMS_TEST_HOME!;
  expect(homedir()).toBe(testHome);
  const { CONFIG } = await import("../src/config.js");
  // Build the expected path with join, as config does: Windows uses its own separators.
  expect(CONFIG.storagePath).toBe(join(testHome, ".omms", "data"));
});

it("refuses a test run that the isolated runner did not start", () => {
  const env = { ...process.env };
  delete env.OMMS_TEST_HOME;
  // Run only the first test, so the child never starts another child.
  const result = spawnSync(
    process.execPath,
    ["test", "tests/test-home-isolation.test.ts", "--test-name-pattern", "empty home folder"],
    {
      env,
      encoding: "utf8",
    }
  );
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain("isolated runner");
}, 30_000);

it("refuses a test run whose home folder is the real one", () => {
  // A temporary folder stands in for the real home, so this never opens ~/.omms.
  const fakeRealHome = mkdtempSync(join(tmpdir(), "omms-fake-real-home-"));
  const result = spawnSync(
    process.execPath,
    ["test", "tests/test-home-isolation.test.ts", "--test-name-pattern", "empty home folder"],
    {
      env: {
        ...process.env,
        HOME: fakeRealHome,
        USERPROFILE: fakeRealHome,
        OMMS_REAL_HOME: fakeRealHome,
      },
      encoding: "utf8",
    }
  );
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain("isolated runner");
}, 30_000);
