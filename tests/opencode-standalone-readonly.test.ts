import { afterAll, beforeAll, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { OPENCODE_NO_MODELS, listOpencodeSettingsModels } from "../src/importer/settings-models.js";

// A real `opencode` stand-in in the folder OMMS checks first. It leaves a marker
// file when it runs, which is what `opencode serve` does to OpenCode's own data.
const binDir = join(homedir(), ".opencode", "bin");
const marker = mkdtempSync(join(tmpdir(), "omms-fake-opencode-"));
const calls = join(marker, "calls");

beforeAll(() => {
  mkdirSync(binDir, { recursive: true });
  // Windows finds the program by PATHEXT, so the stand-in there is a .cmd file.
  if (process.platform === "win32") {
    writeFileSync(join(binDir, "opencode.cmd"), `@echo %* >> "${calls}"\r\n@exit /b 1\r\n`);
    return;
  }
  const program = join(binDir, "opencode");
  writeFileSync(program, `#!/bin/sh\necho "$@" >> "${calls}"\nexit 1\n`);
  chmodSync(program, 0o755);
});
afterAll(() => {
  rmSync(binDir, { recursive: true, force: true });
  rmSync(marker, { recursive: true, force: true });
});

it("never runs OpenCode on a machine with no OpenCode data", async () => {
  expect(existsSync(join(homedir(), ".local/share/opencode"))).toBe(false);
  // The stand-in must be findable, or the test would pass for the wrong reason.
  expect(existsSync(join(binDir, process.platform === "win32" ? "opencode.cmd" : "opencode"))).toBe(
    true
  );
  const listed = await listOpencodeSettingsModels();
  expect(listed).toEqual({ available: false, reason: OPENCODE_NO_MODELS });
  expect(existsSync(calls)).toBe(false);
});
