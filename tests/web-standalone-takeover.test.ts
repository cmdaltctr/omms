import { expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(30_000);

// Under Node, a busy port is reported after listen() returns. The web app must
// still see it, wait as a non-owner, and take the port when the owner stops.
it("takes over the port under Node when the running web app stops", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-web-takeover-"));
  const owner = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, status: "ok", owner: "test" }));
  });
  await new Promise<void>((resolve) => owner.listen(0, "127.0.0.1", resolve));
  const address = owner.address();
  if (!address || typeof address === "string") throw new Error("No free port");
  const port = address.port;
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(
    join(home, ".config", "omms", "omms.jsonc"),
    JSON.stringify({
      storagePath: join(home, "data"),
      webServerEnabled: true,
      webServerAutoStart: false,
      webServerPort: port,
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
  let body: { owner?: string; status?: string } | undefined;
  try {
    // Give the child time to start and meet the busy port.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(child.exitCode).toBeNull();
    owner.closeAllConnections();
    await new Promise<void>((resolve) => owner.close(() => resolve()));

    // The health loop runs every 5 seconds, then a takeover waits up to 1.5 seconds.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        body = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  } finally {
    child.kill("SIGTERM");
    await child.exited;
    rmSync(home, { recursive: true, force: true });
  }
  expect(body?.status).toBe("ok");
  expect(body?.owner).toBeUndefined();
});
