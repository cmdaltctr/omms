import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBunTest, TEST_PARENT_TIMEOUT_MS } from "./test-process.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "omms-test-process-"));
  dirs.push(dir);
  const file = join(dir, "fixture.test.ts");
  writeFileSync(file, `import { it, expect } from "bun:test";\n${body}\n`);
  return file;
}

it(
  "drains both child pipes without losing output",
  async () => {
    const file = fixture(`it("output", () => {
    process.stdout.write("O".repeat(256 * 1024));
    process.stderr.write("E".repeat(256 * 1024));
    expect(1).toBe(1);
  });`);
    const { exitCode, output } = await runBunTest([file]);
    expect(exitCode).toBe(0);
    expect(output).toContain("O".repeat(256 * 1024));
    expect(output).toContain("E".repeat(256 * 1024));
  },
  TEST_PARENT_TIMEOUT_MS
);

it(
  "preserves a failing child's exit code and diagnostics",
  async () => {
    const file = fixture('it("fails", () => { throw new Error("CHILD_ASSERTION_FAILED"); });');
    const { exitCode, output } = await runBunTest([file]);
    expect(exitCode).not.toBe(0);
    expect(output).toContain("CHILD_ASSERTION_FAILED");
  },
  TEST_PARENT_TIMEOUT_MS
);

it("terminates a stalled child before the enclosing test expires", async () => {
  const file = fixture(`it("hangs", async () => {
    console.log("CHILD_STARTED");
    await new Promise(() => {});
  });`);
  const { exitCode, output } = await runBunTest([file], { timeout: 2000 });
  expect(exitCode).not.toBe(0);
  expect(output).toContain("CHILD_STARTED");
}, 10_000);
