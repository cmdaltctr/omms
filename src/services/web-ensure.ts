import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launcherPath } from "./runtime-record.js";
import { isOlderVersion } from "./version-compare.js";
import { negotiateOwner, readWebVersion } from "./web-handover.js";

// The shared start rule: every host calls `ensureWebApp` at session start, and
// at most one standalone web app runs per machine. It imports no host adapter,
// no store, and no embedding model, so the Claude Code hook can use it.

/** Each code maps to a host message or log code; none of them fails the session. */
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

/** The file operations the start lock needs. */
export interface LockFs {
  /** Create the file only when it does not exist. Returns false when it does. */
  createExclusive(path: string, text: string): boolean;
  read(path: string): string | null;
  remove(path: string): void;
  /** Hard-link `from` to `to`. False when `to` exists or `from` is missing. */
  link(from: string, to: string): boolean;
  /** Time since the file's change time, or null when it is missing. A link sets the change time. */
  ageMs(path: string): number | null;
  /** Replace the file in one step, so a reader never finds it missing. */
  replace(path: string, text: string): void;
}

/** Injected so tests run the start rule without a network, a process, or a real clock. */
export interface EnsureDeps {
  fetch: typeof fetch;
  spawn: SpawnFn;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  resolveRuntime: () => Promise<string | null> | string | null;
  /** The `om-memory-system` script that `web` is run from. */
  cliScript: string;
  /** `~/.omms/bin/omms-launch.mjs` when it exists. `web` then starts through it, on the newest recorded copy. */
  launcherScript: string | null;
  lockPath: string;
  lockFs: LockFs;
  pidAlive: (pid: number) => boolean;
  /** The pid written into the lock. */
  pid: number;
  log: (message: string, data: Record<string, unknown>) => void | Promise<void>;
}

/** Hosts differ only in these values; the start rule itself has no host-specific code. */
export interface EnsureOptions {
  settings: EnsureSettings;
  /** How long the caller may wait for the web app to answer. */
  budgetMs: number;
  /** `false` starts the web app and returns at once (session starts). Default `true`. */
  wait?: boolean;
  /**
   * Replace a running web app older than `version`: ask it to step aside, then
   * start as for an empty port. `headers` are the local token headers the
   * step-aside route needs. Without it, any running OMMS web app is used.
   */
  replaceOlder?: { version: string; headers: Record<string, string> };
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

/** Lock files are private to the user (0600 in a 0700 folder), like the token file. */
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
  link(from, to) {
    for (let attempt = 0; ; attempt++) {
      try {
        linkSync(from, to);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST" || code === "ENOENT") return false;
        const waitMs = WINDOWS_FILE_RETRY_WAITS_MS[attempt];
        if (
          process.platform !== "win32" ||
          !code ||
          !WINDOWS_FILE_BUSY_CODES.has(code) ||
          waitMs === undefined
        ) {
          throw error;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
      }
    }
  },
  ageMs(path) {
    try {
      return Date.now() - statSync(path).ctimeMs;
    } catch {
      return null;
    }
  },
  replace(path, text) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, text, { mode: 0o600 });
    renameRetrying(temp, path);
  },
};

// Windows can refuse a link or rename while another process has the file open.
// Bound retries so a permanent permission error still reaches the caller.
const WINDOWS_FILE_RETRY_WAITS_MS = [1, 2, 5, 10, 20, 50, 100, 200];
const WINDOWS_FILE_BUSY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/** `renameSync` that retries while Windows reports the target busy. */
export function renameRetrying(
  from: string,
  to: string,
  rename: (from: string, to: string) => void = renameSync,
  platform: NodeJS.Platform = process.platform,
  wait: (ms: number) => void = (ms) =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
): void {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const waitMs = WINDOWS_FILE_RETRY_WAITS_MS[attempt];
      if (
        platform !== "win32" ||
        !code ||
        !WINDOWS_FILE_BUSY_CODES.has(code) ||
        waitMs === undefined
      ) {
        throw error;
      }
      wait(waitMs);
    }
  }
}

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

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Tests set the switch, so they never start the developer's real recorded copy. */
function existingLauncher(): string | null {
  if (process.env.OMMS_DISABLE_RUNTIME_RECORD === "1") return null;
  const file = launcherPath(join(homedir(), ".omms"));
  return existsSync(file) ? file : null;
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
    launcherScript: existingLauncher(),
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

/** What taking the start lock needs; a test drives two callers through it step by step. */
export type LockDeps = Pick<EnsureDeps, "lockPath" | "lockFs" | "pid" | "now" | "pidAlive">;

function lockIsStale(text: string | null, deps: LockDeps): boolean {
  if (text === null) return true;
  try {
    const { pid, at } = JSON.parse(text) as { pid?: unknown; at?: unknown };
    if (typeof pid !== "number" || typeof at !== "number") return true;
    return !deps.pidAlive(pid) || deps.now() - at > START_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

/**
 * Take the start lock. A stale lock is replaced by one caller only: the caller
 * that hard-links it to a tombstone named after its text. Remove-then-create
 * alone let two callers each remove the lock the other had just created.
 */
export function takeStartLock(deps: LockDeps): boolean {
  const mine = JSON.stringify({ pid: deps.pid, at: deps.now() });
  if (deps.lockFs.createExclusive(deps.lockPath, mine)) return true;
  const seen = deps.lockFs.read(deps.lockPath);
  if (seen === null) return deps.lockFs.createExclusive(deps.lockPath, mine);
  if (!lockIsStale(seen, deps)) return false;
  const tomb = `${deps.lockPath}.${createHash("sha256").update(seen).digest("hex").slice(0, 16)}.stale`;
  if (!deps.lockFs.link(deps.lockPath, tomb)) {
    // A takeover that crashed after its link leaves the tombstone behind. Clear
    // it, and let the next caller do the takeover.
    const age = deps.lockFs.ageMs(tomb);
    if (age !== null && age > START_LOCK_STALE_MS) deps.lockFs.remove(tomb);
    return false;
  }
  try {
    // A slow caller can link a lock that was replaced after it read it. That
    // lock is live, so leave it.
    if (deps.lockFs.read(tomb) !== seen) return false;
    deps.lockFs.remove(deps.lockPath);
    return deps.lockFs.createExclusive(deps.lockPath, mine);
  } finally {
    deps.lockFs.remove(tomb);
  }
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
    const { replaceOlder } = options;
    // An OMMS web app that is older than the newest copy is replaced; any other is used.
    const replacing =
      first === "omms" &&
      replaceOlder !== undefined &&
      isOlderVersion(
        (await readWebVersion(deps.fetch, settings.baseUrl, replaceOlder.headers)) ?? "",
        replaceOlder.version
      );
    if (first === "omms" && !replacing) return "running";
    if (first === "other") {
      await logCode("port-busy");
      return "port-busy";
    }

    const runtime = await deps.resolveRuntime();
    if (!runtime) {
      await logCode("no-runtime");
      return replacing ? "running" : "no-runtime";
    }

    held = takeStartLock(deps);
    // The caller that holds the lock replaces the web app; the others use it.
    if (!held)
      return replacing ? "running" : await waitForOther(settings.baseUrl, wait, remaining, deps);

    if (replacing && replaceOlder) {
      const outcome = await negotiateOwner({
        fetchFn: deps.fetch,
        sleep: deps.sleep,
        url: settings.baseUrl,
        port: Number(new URL(settings.baseUrl).port) || 80,
        headers: replaceOlder.headers,
        version: replaceOlder.version,
      });
      if (outcome.kind !== "handed") {
        if (outcome.kind === "stuck") await logCode("step-aside-failed");
        return "running";
      }
    }

    // Another caller may have finished its start before this one took the lock.
    const second = await probe(settings.baseUrl, probeMs(), deps);
    if (second === "omms") return "running";
    if (second === "other") {
      await logCode("port-busy");
      return "port-busy";
    }

    const child = deps.spawn(runtime, [deps.launcherScript ?? deps.cliScript, "web"], {
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
