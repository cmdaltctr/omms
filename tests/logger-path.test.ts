import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const loggerUrl = pathToFileURL(join(import.meta.dir, "../src/services/logger.js")).href;

/**
 * The logger initialises once per process through a global symbol, so each
 * scenario runs in a fresh child process with a temp HOME.
 */
function runLogScenario(env: Record<string, string>): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "omms-logger-test-"));
  tempDirs.push(home);

  const script = `
const { log } = await import(${JSON.stringify(loggerUrl)});
log("scenario-entry", { marker: true });
`;

  const dir = mkdtempSync(join(tmpdir(), "omms-logger-scenario-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const childEnv: Record<string, string> = { ...process.env, HOME: home, USERPROFILE: home };
  delete childEnv.OMMS_LOG_FILE;
  delete childEnv.OPENCODE_MEM_LOG_FILE;
  for (const [key, value] of Object.entries(env)) {
    childEnv[key] = value;
  }

  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], { env: childEnv });
  return proc.exited.then(() => home);
}

describe("omms log identity", () => {
  it("defaults the log to ~/.omms/omms.log", async () => {
    const home = await runLogScenario({});
    const logPath = join(home, ".omms", "omms.log");
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, "utf-8")).toContain("scenario-entry");
  });

  it("still honours the legacy OPENCODE_MEM_LOG_FILE override", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-logger-test-"));
    tempDirs.push(home);
    const legacyPath = join(home, "legacy.log");
    await runLogScenario({ OPENCODE_MEM_LOG_FILE: legacyPath });
    expect(existsSync(legacyPath)).toBe(true);
    expect(readFileSync(legacyPath, "utf-8")).toContain("scenario-entry");
  });

  it("prefers OMMS_LOG_FILE over the legacy override", async () => {
    const home = mkdtempSync(join(tmpdir(), "omms-logger-test-"));
    tempDirs.push(home);
    const ommsPath = join(home, "omms.log");
    const legacyPath = join(home, "legacy.log");
    await runLogScenario({ OMMS_LOG_FILE: ommsPath, OPENCODE_MEM_LOG_FILE: legacyPath });
    expect(existsSync(ommsPath)).toBe(true);
    expect(readFileSync(ommsPath, "utf-8")).toContain("scenario-entry");
    expect(existsSync(legacyPath)).toBe(false);
  });
});
