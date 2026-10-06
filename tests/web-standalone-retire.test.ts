import { expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(30_000);

/**
 * Start a fake owner that reports `version`, and a standalone web app that meets
 * the busy port. Return the web app's exit code, or "still running" after 12 seconds.
 */
async function waiterOutcome(version: string): Promise<number | string> {
  const home = mkdtempSync(join(tmpdir(), "omms-web-retire-"));
  const owner = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/web/status") res.end(JSON.stringify({ version, canControl: false }));
    else res.end(JSON.stringify({ success: true, status: "ok" }));
  });
  await new Promise<void>((resolve) => owner.listen(0, "127.0.0.1", resolve));
  const address = owner.address();
  if (!address || typeof address === "string") throw new Error("No free port");
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(
    join(home, ".config", "omms", "omms.jsonc"),
    JSON.stringify({
      storagePath: join(home, "data"),
      webServerEnabled: true,
      webServerAutoStart: false,
      webServerPort: address.port,
      webServerHost: "127.0.0.1",
    })
  );
  const child = Bun.spawn(["node", "dist/cli/index.js", "web"], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_LOG_FILE: join(home, "omms.log"),
      OMMS_DISABLE_AUTO_BACKFILL: "1",
      OMMS_DISABLE_WEB_AUTOSTART: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    // The health loop runs every 5 seconds.
    return await Promise.race([
      child.exited,
      new Promise<string>((resolve) => setTimeout(() => resolve("still running"), 12_000)),
    ]);
  } finally {
    child.kill("SIGKILL");
    await child.exited;
    owner.closeAllConnections();
    await new Promise<void>((resolve) => owner.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
}

it("exits with code 0 while it waits behind a newer web app", async () => {
  expect(await waiterOutcome("99.0.0")).toBe(0);
});

it("keeps waiting behind an older web app", async () => {
  expect(await waiterOutcome("0.0.1")).toBe("still running");
});
