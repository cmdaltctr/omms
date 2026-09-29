import { expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(30_000);

// Under Node, `listen` reports EADDRINUSE after it returns. A web app started
// while another program holds the port must still become a non-owner and take
// the port over once it is free, not stay alive without serving.
it("takes over the port under Node after another program releases it", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-web-port-in-use-"));
  const foreign = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => foreign.listen(0, "127.0.0.1", resolve));
  const address = foreign.address();
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
    stdout: "ignore",
    stderr: "ignore",
  });
  let healthy = false;
  try {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await new Promise<void>((resolve) => foreign.close(() => resolve()));
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !healthy) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        const body = (await response.json()) as { success?: boolean; status?: string };
        healthy = body.success === true && body.status === "ok";
      } catch {
        // Not listening yet.
      }
      if (!healthy) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    child.kill("SIGTERM");
    await child.exited;
    foreign.close();
    rmSync(home, { recursive: true, force: true });
  }
  expect(healthy).toBe(true);
});
