import { expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(20_000);

it("serves settings without a host and stops on SIGTERM", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-web-standalone-"));
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No free port");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
  const cwd = join(import.meta.dir, "..");
  const child = Bun.spawn(["node", "dist/cli/index.js", "web"], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_LOG_FILE: join(home, "omms.log"),
      OMMS_DISABLE_AUTO_BACKFILL: "1",
      OMMS_DISABLE_WEB_AUTOSTART: "1",
    },
    stderr: "pipe",
  });
  let response: Response | undefined;
  let body: { settings?: object } | undefined;
  let errorText: string;
  let outputText: string;
  let exitCode: number;
  let lastFetchError = "";
  try {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/settings`);
        break;
      } catch (error) {
        lastFetchError = String(error);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (response?.status === 401) {
      const token = readFileSync(join(home, ".omms", ".auth-token"), "utf8").trim();
      response = await fetch(`http://127.0.0.1:${port}/api/settings`, {
        headers: { "x-omms-token": token },
      });
    }
    if (response) body = (await response.json()) as { settings?: object };
  } finally {
    child.kill("SIGTERM");
    const exit = await Promise.race([
      child.exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
    ]);
    if (exit === null) {
      child.kill("SIGKILL");
      await child.exited;
    }
    exitCode = await child.exited;
    errorText = await new Response(child.stderr).text();
    outputText = await new Response(child.stdout).text();
    expect(exit).not.toBeNull();
    rmSync(home, { recursive: true, force: true });
  }
  if (!response)
    throw new Error(
      `Standalone web server did not answer (exit ${exitCode}): ${outputText.slice(0, 1000)} ${errorText.slice(0, 1000)} ${lastFetchError}`
    );
  expect(response.status).toBe(200);
  expect(body?.settings).toBeDefined();
});
