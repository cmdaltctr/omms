import { expect, it, setDefaultTimeout } from "bun:test";
import { rmSync } from "node:fs";
import { startStandaloneWeb, takePort } from "./standalone-web-fixture.js";

setDefaultTimeout(30_000);

it("exits with code 0 when a newer OMMS asks the standalone web app to step aside", async () => {
  const { home, port, token, child } = await startStandaloneWeb();
  let newOwner: ReturnType<typeof Bun.serve> | undefined;
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
    // The old web app exits once the caller's copy owns the port; a stand-in plays that copy.
    newOwner = await takePort(port);
    const code = await Promise.race([
      child.exited,
      new Promise<string>((resolve) => setTimeout(() => resolve("still running"), 5_000)),
    ]);
    expect(code).toBe(0);
  } finally {
    newOwner?.stop(true);
    child.kill("SIGKILL");
    await child.exited;
    rmSync(home, { recursive: true, force: true });
  }
});

it("keeps waiting while no new owner takes the port", async () => {
  const { home, port, token, child } = await startStandaloneWeb();
  try {
    const accepted = await fetch(`http://127.0.0.1:${port}/api/web/step-aside`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-omms-token": token },
      body: JSON.stringify({ version: "99.0.0" }),
    });
    expect(accepted.status).toBe(202);
    // Before the fix it exited at once and left the port empty.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(child.exitCode).toBeNull();
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toBeDefined();
  } finally {
    child.kill("SIGKILL");
    await child.exited;
    rmSync(home, { recursive: true, force: true });
  }
});
