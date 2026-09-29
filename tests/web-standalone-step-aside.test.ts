import { expect, it, setDefaultTimeout } from "bun:test";
import { rmSync } from "node:fs";
import { startStandaloneWeb } from "./standalone-web-fixture.js";

setDefaultTimeout(30_000);

it("exits with code 0 when a newer OMMS asks the standalone web app to step aside", async () => {
  const { home, port, token, child } = await startStandaloneWeb();
  try {
    const url = `http://127.0.0.1:${port}/api/web/step-aside`;
    const headers = { "content-type": "application/json", "x-omms-token": token };
    const refused = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ version: "0.0.1" }),
    });
    expect(refused.status).toBe(409);
    expect(child.exitCode).toBeNull();

    const accepted = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ version: "99.0.0" }),
    });
    expect(accepted.status).toBe(202);
    const code = await Promise.race([
      child.exited,
      new Promise<string>((resolve) => setTimeout(() => resolve("still running"), 5_000)),
    ]);
    expect(code).toBe(0);
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toBeDefined();
  } finally {
    child.kill("SIGKILL");
    await child.exited;
    rmSync(home, { recursive: true, force: true });
  }
});
