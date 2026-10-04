import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("checks the step-aside hold-off after slow shutdown finishes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-slow-shutdown-"));
  dirs.push(dir);
  const preload = join(dir, "delay-shutdown.mjs");
  writeFileSync(
    preload,
    `
import { mock } from "bun:test";
import * as fs from "node:fs";
const originalWrite = fs.writeFileSync;
function writeFileSync(path, data, ...args) {
  if (String(path).endsWith("scenario.mjs") && typeof data === "string") {
    const marker = "const result = {};";
    if (!data.includes(marker)) throw new Error("Missing shutdown injection point");
    data = data.replace(marker, marker + \`
      const originalStop = WebServer.prototype.stop;
      let delayed = false;
      WebServer.prototype.stop = async function () {
        await originalStop.call(this);
        if (!delayed) {
          delayed = true;
          await Bun.sleep(2500);
        }
      };
    \`);
    console.log("SLOW_SHUTDOWN_INJECTED");
  }
  return originalWrite(path, data, ...args);
}
mock.module("node:fs", () => ({ ...fs, default: { ...fs.default, writeFileSync }, writeFileSync }));
`
  );
  const proc = Bun.spawn({
    cmd: [
      process.execPath,
      "test",
      "--preload",
      preload,
      "--test-name-pattern",
      "stops serving, keeps the process alive",
      join(import.meta.dir, "web-step-aside.test.ts"),
    ],
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 45_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stdout).toContain("SLOW_SHUTDOWN_INJECTED");
  expect(exitCode, stdout + stderr).toBe(0);
}, 60_000);
