import { expect, it, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listeners } from "./port-listeners.js";

setDefaultTimeout(60_000);

const repoRoot = join(import.meta.dir, "..");
// Node imports need a file URL. A Windows path such as D:\... is not one.
const webEnsureModule = pathToFileURL(join(repoRoot, "dist", "services", "web-ensure.js")).href;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        address && typeof address !== "string"
          ? resolve(address.port)
          : reject(new Error("no port"))
      );
    });
  });
}

/** Windows can hold a just-closed file for a moment (EBUSY). A leftover temp folder is harmless there. */
function removeHome(home: string) {
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    const locked = (error as NodeJS.ErrnoException).code === "EBUSY";
    if (process.platform !== "win32" || !locked) throw error;
  }
}

it("starts exactly one web app for two host processes that start at once", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-ensure-real-"));
  const port = await freePort();
  const token = "test-token-for-ensure";
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  mkdirSync(join(home, ".omms"), { recursive: true });
  writeFileSync(join(home, ".omms", ".auth-token"), token, { mode: 0o600 });
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
  const script = `
    import { ensureWebApp } from ${JSON.stringify(webEnsureModule)};
    const result = await ensureWebApp({
      settings: { enabled: true, baseUrl: "http://127.0.0.1:${port}" },
      budgetMs: 30000,
    });
    console.log(result);
  `;
  const caller = () =>
    Bun.spawn(["node", "--input-type=module", "-e", script], {
      cwd: repoRoot,
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
    const callers = [caller(), caller()];
    const outputs = await Promise.all(
      callers.map(async (proc) => {
        const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        return { out: out.trim(), code };
      })
    );
    expect(outputs.map((entry) => entry.code)).toEqual([0, 0]);
    expect(outputs.map((entry) => entry.out).sort()).toEqual(["running", "started"]);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.ok).toBe(true);
    expect(await listeners(port)).toHaveLength(1);
  } finally {
    // Ask the detached web app to exit, as a newer OMMS would.
    await fetch(`http://127.0.0.1:${port}/api/web/step-aside`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-omms-token": token },
      body: JSON.stringify({ version: "99.0.0" }),
    }).catch(() => undefined);
    for (let i = 0; i < 50 && (await listeners(port)).length > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const pid of await listeners(port)) process.kill(Number(pid), "SIGKILL");
    removeHome(home);
  }
});

it("gives a stale start lock to exactly one of several processes that replace it at once", async () => {
  const home = mkdtempSync(join(tmpdir(), "omms-lock-real-"));
  const lock = join(home, ".omms", "web-start.lock");
  const go = join(home, "go");
  mkdirSync(join(home, ".omms"), { recursive: true });
  // A lock from a crashed start: old enough to be stale whatever its pid.
  writeFileSync(lock, JSON.stringify({ pid: 999_999, at: Date.now() - 60_000 }));
  const script = `
    import { existsSync } from "node:fs";
    import { nodeLockFs, takeStartLock } from ${JSON.stringify(webEnsureModule)};
    while (!existsSync(${JSON.stringify(go)})) await new Promise((r) => setTimeout(r, 1));
    const held = takeStartLock({
      lockPath: ${JSON.stringify(lock)},
      lockFs: nodeLockFs,
      pid: process.pid,
      now: () => Date.now(),
      pidAlive: (pid) => {
        try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
      },
    });
    console.log(JSON.stringify({ pid: process.pid, held }));
    // Stay alive, so the winner's lock is not stale while the others run.
    await new Promise((r) => setTimeout(r, 1500));
  `;
  try {
    const callers = Array.from({ length: 6 }, () =>
      Bun.spawn(["node", "--input-type=module", "-e", script], { stdout: "pipe", stderr: "pipe" })
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    writeFileSync(go, "");
    const results = await Promise.all(
      callers.map(async (proc) => {
        const [out, err, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        // Show the child's error: a bare exit code hides why a start-lock race failed.
        if (code !== 0) throw new Error(`caller exited ${code}: ${err.trim().slice(0, 800)}`);
        return JSON.parse(out.trim()) as { pid: number; held: boolean };
      })
    );
    const winners = results.filter((result) => result.held);
    expect(winners).toHaveLength(1);
    expect(JSON.parse(readFileSync(lock, "utf8"))).toMatchObject({ pid: winners[0]?.pid });
    expect(readdirSync(join(home, ".omms")).filter((name) => name.endsWith(".stale"))).toEqual([]);
  } finally {
    removeHome(home);
  }
});
