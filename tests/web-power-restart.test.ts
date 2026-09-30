import { expect, it, setDefaultTimeout } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { listeners } from "./port-listeners.js";
import { startStandaloneWeb } from "./standalone-web-fixture.js";

setDefaultTimeout(60_000);

async function waitFor<T>(read: () => Promise<T | null>, ms: number): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

it("restarts as a new process on the same port, then stops with exit code 0", async () => {
  const { home, port, token, child } = await startStandaloneWeb();
  const post = (path: string, headers: Record<string, string> = { "x-omms-token": token }) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    });
  const base = `http://127.0.0.1:${port}`;
  let newPid: string | undefined;
  try {
    expect((await post("/api/web/restart", {})).status).toBe(401);
    expect(child.exitCode).toBeNull();

    const status = await fetch(`${base}/api/web/status`, { headers: { "x-omms-token": token } });
    expect(await status.json()).toMatchObject({ canControl: true });

    const oldPid = String(child.pid);
    expect((await post("/api/web/restart")).status).toBe(202);
    expect(await Promise.race([child.exited, waitFor(async () => null, 10_000)])).toBe(0);
    // A new process answers on the same port.
    const answered = await waitFor(async () => {
      try {
        return (await fetch(`${base}/api/health`)).ok ? true : null;
      } catch {
        return null;
      }
    }, 20_000);
    expect(answered).toBe(true);
    const pids = await listeners(port);
    expect(pids).toHaveLength(1);
    newPid = pids[0];
    expect(newPid).not.toBe(oldPid);

    // Stop the new process. It runs detached, so its exit is seen through the port.
    expect((await post("/api/web/stop")).status).toBe(202);
    const gone = await waitFor(
      async () => ((await listeners(port)).length === 0 ? true : null),
      10_000
    );
    expect(gone).toBe(true);
  } finally {
    child.kill("SIGKILL");
    await child.exited;
    for (const pid of await listeners(port)) process.kill(Number(pid), "SIGKILL");
    rmSync(home, { recursive: true, force: true });
  }
});

it("exits with code 0 on Stop", async () => {
  const { home, port, token, child } = await startStandaloneWeb();
  try {
    const stopped = await fetch(`http://127.0.0.1:${port}/api/web/stop`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-omms-token": token },
      body: "{}",
    });
    expect(stopped.status).toBe(202);
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

it("keeps serving on the same process when the restarted copy cannot start", async () => {
  // Run from a copy of the build, then remove its CLI entry. This process has
  // loaded it already; a fresh copy fails at once.
  const version = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"))
    .version as string;
  const { home, port, token, child, root } = await startStandaloneWeb(version);
  const base = `http://127.0.0.1:${port}`;
  try {
    rmSync(join(root, "dist", "cli", "index.js"));
    const restart = await fetch(`${base}/api/web/restart`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-omms-token": token },
      body: "{}",
    });
    expect(restart.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    expect(child.exitCode).toBeNull();
    expect(await listeners(port)).toEqual([String(child.pid)]);
    expect((await fetch(`${base}/api/health`)).ok).toBe(true);
    const log = readFileSync(join(home, "omms.log"), "utf8");
    expect(log).toContain("Web app restart failed");
    expect(log).toContain("copy-exit");
  } finally {
    child.kill("SIGKILL");
    await child.exited;
    for (const pid of await listeners(port)) process.kill(Number(pid), "SIGKILL");
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
