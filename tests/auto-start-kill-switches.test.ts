import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("passes automatic start kill switches to spawned Bun children", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-kill-switches-"));
  try {
    const script = join(dir, "child.mjs");
    writeFileSync(
      script,
      "console.log(JSON.stringify([process.env.OMMS_DISABLE_AUTO_BACKFILL, process.env.OMMS_DISABLE_WEB_AUTOSTART]))"
    );
    const proc = Bun.spawn(["bun", "run", script], { cwd: dir });
    const output = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(JSON.parse(output.trim())).toEqual(["1", "1"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
