import { expect, it } from "bun:test";
import { homedir } from "node:os";

// scripts/run-tests-isolated.sh gives each run an empty home folder, so tests
// never open the developer's real ~/.omms store. Bun reads the home folder once
// at process start, so only the runner can set it.
it.skipIf(!process.env.OMMS_TEST_HOME)("runs with the runner's empty home folder", async () => {
  expect(homedir()).toBe(process.env.OMMS_TEST_HOME!);
  const { CONFIG } = await import("../src/config.js");
  expect(CONFIG.storagePath.startsWith(process.env.OMMS_TEST_HOME!)).toBe(true);
});
