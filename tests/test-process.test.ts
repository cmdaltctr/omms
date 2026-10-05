import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBunProcess, runBunTest, TEST_PARENT_TIMEOUT_MS } from "./test-process.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(body: string, name = "fixture.test.ts") {
  const dir = mkdtempSync(join(tmpdir(), "omms-test-process-"));
  dirs.push(dir);
  const file = join(dir, name);
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

it(
  "drains a scenario's stderr before it produces stdout",
  async () => {
    const file = fixture(
      `
await Bun.write(Bun.stderr, "E".repeat(256 * 1024));
await Bun.write(Bun.stdout, "O".repeat(256 * 1024));
`,
      "scenario.mjs"
    );
    const { exitCode, output } = await runBunProcess(["run", file], { timeout: 5000 });
    expect(exitCode).toBe(0);
    expect(output).toContain("O".repeat(256 * 1024));
    expect(output).toContain("E".repeat(256 * 1024));
  },
  TEST_PARENT_TIMEOUT_MS
);

it("starts reading stderr while stdout is still waiting", async () => {
  const originalSpawn = Bun.spawn;
  let stderrStarted!: () => void;
  const stderrRead = new Promise<void>((resolve) => {
    stderrStarted = resolve;
  });
  const stdout = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        await Promise.race([
          stderrRead,
          Bun.sleep(100).then(() => {
            throw new Error("STDERR_NOT_DRAINED_CONCURRENTLY");
          }),
        ]);
        controller.enqueue(new TextEncoder().encode("SCENARIO_STDOUT"));
        controller.close();
      },
    },
    { highWaterMark: 0 }
  );
  const stderr = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        stderrStarted();
        controller.enqueue(new TextEncoder().encode("SCENARIO_STDERR"));
        controller.close();
      },
    },
    { highWaterMark: 0 }
  );
  // Model only the process I/O boundary; the shared runner remains real.
  Bun.spawn = (() => ({
    stdout,
    stderr,
    exited: Promise.resolve(0),
  })) as unknown as typeof Bun.spawn;
  try {
    const result = await runBunProcess(["run", "synthetic-scenario.mjs"]);
    expect(result).toEqual({
      exitCode: 0,
      stdout: "SCENARIO_STDOUT",
      output: "SCENARIO_STDOUT\nSCENARIO_STDERR",
    });
  } finally {
    Bun.spawn = originalSpawn;
  }
});

it(
  "keeps a scenario's exit code and both diagnostic streams",
  async () => {
    const file = fixture(
      `
console.log("SCENARIO_STDOUT");
console.error("SCENARIO_STDERR");
process.exit(7);
`,
      "scenario.mjs"
    );
    const { exitCode, output } = await runBunProcess(["run", file]);
    expect(exitCode).toBe(7);
    expect(output).toContain("SCENARIO_STDOUT");
    expect(output).toContain("SCENARIO_STDERR");
  },
  TEST_PARENT_TIMEOUT_MS
);

it("terminates a stalled scenario before the enclosing test expires", async () => {
  const file = fixture(
    `
console.log("SCENARIO_STARTED");
await new Promise(() => { setInterval(() => {}, 1000); });
`,
    "scenario.mjs"
  );
  const { exitCode, output } = await runBunProcess(["run", file], { timeout: 2000 });
  expect(exitCode).not.toBe(0);
  expect(output).toContain("SCENARIO_STARTED");
}, 10_000);
