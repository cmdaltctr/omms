import { expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

// scripts/run-tests-isolated.sh gives each run an empty home folder, so tests
// never open the developer's real ~/.omms store. Bun reads the home folder once
// at process start, so only the runner can set it.
it.skipIf(!process.env.OMMS_TEST_HOME)("runs with the runner's empty home folder", async () => {
  const testHome = process.env.OMMS_TEST_HOME!;
  expect(homedir()).toBe(testHome);
  const { CONFIG } = await import("../src/config.js");
  // Build the expected path with join, as config does: Windows uses its own separators.
  expect(CONFIG.storagePath).toBe(join(testHome, ".omms", "data"));
});
