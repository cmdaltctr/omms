import { expect, it } from "bun:test";
import { resolve } from "node:path";

it("runs the Claude Code capture status render tests", () => {
  const web = resolve(import.meta.dir, "../web");
  const result = Bun.spawnSync(
    [
      process.execPath,
      "test",
      `--tsconfig-override=${resolve(web, "tsconfig.app.json")}`,
      "tests/claude-capture-status.spec.tsx",
    ],
    { cwd: web, stdout: "pipe", stderr: "pipe" }
  );
  const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
  expect(result.exitCode, output).toBe(0);
});
