import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const loggerUrl = pathToFileURL(join(import.meta.dir, "../src/services/logger.js")).href;

const TIMESTAMP = "\\[\\d{4}-\\d{2}-\\d{2}T[\\d:.]+[+-]\\d{2}:\\d{2}\\]";

let workDir = "";
let lines: string[] = [];

/**
 * The logger initialises once per process, so the calls run in a child process
 * with its own log file.
 */
beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "omms-logger-level-"));
  const logFile = join(workDir, "omms.log");
  const scriptPath = join(workDir, "scenario.mjs");
  writeFileSync(
    scriptPath,
    `
const { log } = await import(${JSON.stringify(loggerUrl)});
log("plain");
log("with data", { host: "pi" });
log("warned", undefined, "warn");
log("warned with data", { reason: "retry" }, "warn");
log("failed", { error: "boom" }, "error");
log("failed bare", undefined, "error");
`
  );
  const env: Record<string, string> = { ...process.env, OMMS_LOG_FILE: logFile, HOME: workDir };
  delete env.OPENCODE_MEM_LOG_FILE;
  const proc = Bun.spawn(["bun", "run", scriptPath], { cwd: workDir, env });
  await proc.exited;
  lines = readFileSync(logFile, "utf-8").split("\n");
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function find(message: string): string {
  const line = lines.find((l) => new RegExp(`^${TIMESTAMP} [A-Z]+ ${message}(:|$)`).test(l));
  if (!line) throw new Error(`No log line for "${message}" in:\n${lines.join("\n")}`);
  return line;
}

describe("logger levels", () => {
  it("writes INFO when no level is given", () => {
    expect(find("plain")).toMatch(new RegExp(`^${TIMESTAMP} INFO plain$`));
  });

  it("writes WARN for the warn level", () => {
    expect(find("warned")).toMatch(new RegExp(`^${TIMESTAMP} WARN warned$`));
  });

  it("writes ERROR for the error level", () => {
    expect(find("failed bare")).toMatch(new RegExp(`^${TIMESTAMP} ERROR failed bare$`));
  });

  it("keeps data as JSON after a colon and a space", () => {
    expect(find("with data")).toMatch(
      new RegExp(`^${TIMESTAMP} INFO with data: \\{"host":"pi"\\}$`)
    );
    expect(find("warned with data")).toMatch(
      new RegExp(`^${TIMESTAMP} WARN warned with data: \\{"reason":"retry"\\}$`)
    );
    expect(find("failed")).toMatch(new RegExp(`^${TIMESTAMP} ERROR failed: \\{"error":"boom"\\}$`));
  });

  it("leaves the session start marker unchanged", () => {
    expect(
      lines.some((l) =>
        /^--- Session started: \d{4}-\d{2}-\d{2}T[\d:.]+[+-]\d{2}:\d{2} ---$/.test(l)
      )
    ).toBe(true);
  });
});
