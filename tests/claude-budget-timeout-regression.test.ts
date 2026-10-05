import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBunTest, TEST_PARENT_TIMEOUT_MS } from "./test-process.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scenarioPreload(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "omms-claude-deadline-regression-"));
  dirs.push(dir);
  const childPreload = join(dir, "child.mjs");
  writeFileSync(childPreload, body);
  const preload = join(dir, "spawn-preload.mjs");
  // Intercept the process boundary only. The budget assertions and real temporary
  // database work still run in the original test, unless a failure is injected.
  writeFileSync(
    preload,
    `
const originalSpawn = Bun.spawn;
Bun.spawn = function (command, options) {
  const cmd = Array.isArray(command) ? command : command.cmd;
  if (cmd?.some(arg => /scenario-\\d+\\.mjs$/.test(arg))) {
    console.error("CLAUDE_SCENARIO_PRELOAD_INJECTED");
    const injected = [...cmd.slice(0, 2), "--preload", ${JSON.stringify(childPreload)}, ...cmd.slice(2)];
    return Array.isArray(command)
      ? originalSpawn(injected, options)
      : originalSpawn({ ...command, cmd: injected });
  }
  return originalSpawn(command, options);
};
`
  );
  return preload;
}

it(
  "keeps the real Claude config-edit assertions when child startup exceeds five seconds",
  async () => {
    const preload = scenarioPreload(`
console.error("SLOW_CLAUDE_CHILD_STARTED");
await Bun.sleep(5500);
`);
    const { exitCode, output } = await runBunTest([
      "--timeout",
      "5000",
      "--preload",
      preload,
      "--test-name-pattern",
      "applies a config edit to the next request",
      join(import.meta.dir, "claude-injection-budget.test.ts"),
    ]);
    expect(output).toContain("applies a config edit to the next request");
    expect(output).toContain("CLAUDE_SCENARIO_PRELOAD_INJECTED");
    expect(output).not.toContain("timed out after 5000ms");
    if (exitCode !== 0) throw new Error(output);
    expect(exitCode).toBe(0);
    expect(output).toContain("1 pass");
  },
  TEST_PARENT_TIMEOUT_MS
);

it(
  "rejects a failed scenario even when it prints a valid-looking result",
  async () => {
    const preload = scenarioPreload(`
console.log('RESULT:' + JSON.stringify({ beforeBytes: 100, afterBytes: 100, newBudget: 1200, afterClosed: true }));
console.error("CLAUDE_SCENARIO_FAILED");
process.exit(23);
`);
    const { exitCode, output } = await runBunTest([
      "--preload",
      preload,
      "--test-name-pattern",
      "applies a config edit to the next request",
      join(import.meta.dir, "claude-injection-budget.test.ts"),
    ]);
    expect(exitCode).not.toBe(0);
    expect(output).toContain("scenario exited with code 23");
    expect(output).toContain("CLAUDE_SCENARIO_FAILED");
  },
  TEST_PARENT_TIMEOUT_MS
);

it(
  "does not use stderr as a successful scenario result",
  async () => {
    const preload = scenarioPreload(`
console.error('RESULT:' + JSON.stringify({ beforeBytes: 100, afterBytes: 100, newBudget: 1200, afterClosed: true }));
process.exit(0);
`);
    const { exitCode, output } = await runBunTest([
      "--preload",
      preload,
      "--test-name-pattern",
      "applies a config edit to the next request",
      join(import.meta.dir, "claude-injection-budget.test.ts"),
    ]);
    expect(exitCode).not.toBe(0);
    expect(output).toContain("scenario produced no result");
  },
  TEST_PARENT_TIMEOUT_MS
);
