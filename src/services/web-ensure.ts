import { spawn as nodeSpawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The shared start rule: every host calls `ensureWebApp` at session start, and
// at most one standalone web app runs per machine. It imports no host adapter,
// no store, and no embedding model, so the Claude Code hook can use it.

export type EnsureResult =
  "running" | "started" | "disabled" | "port-busy" | "no-runtime" | "start-timeout";

/** Port and switch of the web app, as the caller read them from `CONFIG`. */
export interface EnsureSettings {
  enabled: boolean;
  baseUrl: string;
}

interface SpawnedChild {
  unref(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

type SpawnFn = (
  command: string,
  args: string[],
  options: { detached: true; stdio: "ignore"; cwd: string; windowsHide: true }
) => SpawnedChild;

/** The three file operations the start lock needs. */
export interface LockFs {
  /** Create the file only when it does not exist. Returns false when it does. */
  createExclusive(path: string, text: string): boolean;
  read(path: string): string | null;
  remove(path: string): void;
}

export interface EnsureDeps {
  fetch: typeof fetch;
  spawn: SpawnFn;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  resolveRuntime: () => Promise<string | null> | string | null;
  /** The `om-memory-system` script that `web` is run from. */
  cliScript: string;
  lockPath: string;
  lockFs: LockFs;
  pidAlive: (pid: number) => boolean;
  /** The pid written into the lock. */
  pid: number;
  log: (message: string, data: Record<string, unknown>) => void | Promise<void>;
}

export interface EnsureOptions {
  settings: EnsureSettings;
  /** How long the caller may wait for the web app to answer. */
  budgetMs: number;
  /** `false` starts the web app and returns at once (session starts). Default `true`. */
  wait?: boolean;
  deps?: Partial<EnsureDeps>;
}

const HEALTH_PROBE_MS = 1_000;
const POLL_INTERVAL_MS = 250;
/** A lock older than this is stale. Also the longest a background start holds it. */
export const START_LOCK_STALE_MS = 20_000;

/** Path of the start lock; the standalone command writes it for a restart copy. */
export function startLockPath(home = homedir()): string {
  return join(home, ".omms", "web-start.lock");
}

export const nodeLockFs: LockFs = {
  createExclusive(path, text) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, text, { flag: "wx", mode: 0o600 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  },
  read(path) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  remove(path) {
    rmSync(path, { force: true });
  },
};

/** Remove the start lock when it names `pid`. A restart copy calls this once it owns the port. */
export function removeStartLockFor(
  pid: number,
  path = startLockPath(),
  lockFs: LockFs = nodeLockFs
): void {
  try {
    const held = JSON.parse(lockFs.read(path) ?? "null") as { pid?: unknown } | null;
    if (held?.pid === pid) lockFs.remove(path);
  } catch {
    /* An unreadable lock is stale and the next caller replaces it. */
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function productionDefaults(): EnsureDeps {
  return {
    fetch: globalThis.fetch,
    spawn: nodeSpawn as unknown as SpawnFn,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    resolveRuntime: async () => (await import("./web-autostart.js")).resolveWebRuntime(),
    // From dist/services/ to the CLI entry point.
    cliScript: fileURLToPath(new URL("../cli/index.js", import.meta.url)),
    lockPath: startLockPath(),
    lockFs: nodeLockFs,
    pidAlive: processAlive,
    pid: process.pid,
    log: async (message, data) => (await import("./logger.js")).log(message, data),
  };
}

type Probe = "omms" | "other" | "none";

/** An OMMS reply is `{ success: true, status: "ok" }`; another local service must not count. */
async function probe(baseUrl: string, timeoutMs: number, deps: EnsureDeps): Promise<Probe> {
  try {
    const response = await deps.fetch(`${baseUrl}/api/health`, {
      method: "GET",
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
    if (!response.ok) return "other";
    const body = (await response.json()) as { success?: unknown; status?: unknown };
    return body.success === true && body.status === "ok" ? "omms" : "other";
  } catch (error) {
    // A reply that is not JSON came from a program that answered; a refused or
    // timed out connection means nothing answers.
    return error instanceof SyntaxError ? "other" : "none";
  }
}

function lockIsStale(text: string | null, deps: EnsureDeps): boolean {
  if (text === null) return true;
  try {
    const { pid, at } = JSON.parse(text) as { pid?: unknown; at?: unknown };
    if (typeof pid !== "number" || typeof at !== "number") return true;
    return !deps.pidAlive(pid) || deps.now() - at > START_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

/** Take the start lock. A stale lock is removed and taken once more. */
function takeLock(deps: EnsureDeps): boolean {
  const mine = JSON.stringify({ pid: deps.pid, at: deps.now() });
  if (deps.lockFs.createExclusive(deps.lockPath, mine)) return true;
  const seen = deps.lockFs.read(deps.lockPath);
  if (!lockIsStale(seen, deps)) return false;
  // Another caller may have replaced the stale lock since it was read.
  if (deps.lockFs.read(deps.lockPath) !== seen) return false;
  deps.lockFs.remove(deps.lockPath);
  return deps.lockFs.createExclusive(deps.lockPath, mine);
}

/**
 * Use a running OMMS web app, or start one detached `om-memory-system web`.
 * Never throws; a failed check must not block or fail the host session.
 */
export async function ensureWebApp(options: EnsureOptions): Promise<EnsureResult> {
  const { settings, budgetMs, wait = true } = options;
  if (!settings.enabled) return "disabled";
  const deps: EnsureDeps = { ...productionDefaults(), ...options.deps };
  const began = deps.now();
  const remaining = () => budgetMs - (deps.now() - began);
  const probeMs = () =>
    budgetMs > 0 ? Math.min(HEALTH_PROBE_MS, Math.max(1, remaining())) : HEALTH_PROBE_MS;
  const logCode = async (code: string) => {
    try {
      await deps.log("Web app ensure", { code });
    } catch {
      /* A failed log line must not break the host. */
    }
  };
  let held = false;
  try {
    const first = await probe(settings.baseUrl, probeMs(), deps);
    if (first === "omms") return "running";
    if (first === "other") {
      await logCode("port-busy");
      return "port-busy";
    }

    const runtime = await deps.resolveRuntime();
    if (!runtime) {
      await logCode("no-runtime");
      return "no-runtime";
    }

    held = takeLock(deps);
    if (!held) return await waitForOther(settings.baseUrl, wait, remaining, deps);

    // Another caller may have finished its start before this one took the lock.
    const second = await probe(settings.baseUrl, probeMs(), deps);
    if (second === "omms") return "running";
    if (second === "other") {
      await logCode("port-busy");
      return "port-busy";
    }

    const child = deps.spawn(runtime, [deps.cliScript, "web"], {
      detached: true,
      stdio: "ignore",
      cwd: homedir(),
      windowsHide: true,
    });
    // A missing runtime reports through this event; polling then runs out.
    child.on("error", () => undefined);
    child.unref();

    if (!wait) {
      // Keep the lock until the web app answers, so a second host waits for it.
      const releaseWhenUp = pollUntilUp(settings.baseUrl, START_LOCK_STALE_MS, deps)
        .catch(() => false)
        .finally(() => removeStartLockFor(deps.pid, deps.lockPath, deps.lockFs));
      void releaseWhenUp;
      held = false;
      return "started";
    }
    const up = await pollUntilUp(settings.baseUrl, remaining(), deps);
    return up ? "started" : "start-timeout";
  } catch {
    await logCode("error");
    return "start-timeout";
  } finally {
    if (held) removeStartLockFor(deps.pid, deps.lockPath, deps.lockFs);
  }
}

/** A caller without the lock never spawns. It waits for the caller that holds it. */
async function waitForOther(
  baseUrl: string,
  wait: boolean,
  remaining: () => number,
  deps: EnsureDeps
): Promise<EnsureResult> {
  if (!wait) return "started";
  return (await pollUntilUp(baseUrl, remaining(), deps)) ? "running" : "start-timeout";
}

/** Poll health every 250 ms until an OMMS web app answers or the budget ends. */
async function pollUntilUp(baseUrl: string, budgetMs: number, deps: EnsureDeps): Promise<boolean> {
  const began = deps.now();
  const remaining = () => budgetMs - (deps.now() - began);
  while (remaining() > 0) {
    await deps.sleep(Math.min(POLL_INTERVAL_MS, remaining()));
    if (remaining() <= 0) break;
    if ((await probe(baseUrl, Math.min(HEALTH_PROBE_MS, remaining()), deps)) === "omms")
      return true;
  }
  return false;
}
