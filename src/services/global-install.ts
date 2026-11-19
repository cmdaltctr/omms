import { homedir } from "node:os";
import { join } from "node:path";
import { removeStartLockFor, takeStartLock, type LockDeps } from "./web-ensure.js";
import type { InstallResult } from "./web-update.js";

// The install lock: only one `npm install -g om-memory-system` runs on a machine.
// On 14 November two web apps saw the same release, both ran npm on the same
// folder, and one left `js-base64` empty. The web app and `web update` both go
// through `guardedInstall`. It takes no config, so tests pass every input.

/** Longer than the 5-minute npm timeout, so only a holder that is gone loses the lock. */
export const INSTALL_LOCK_STALE_MS = 6 * 60 * 1000;

export function installLockPath(home = homedir()): string {
  return join(home, ".omms", "global-install.lock");
}

export interface InstallLock {
  /** False when a live caller holds a lock younger than 6 minutes. */
  take(): boolean;
  /** Write a fresh time into a lock this caller holds. */
  refresh(): void;
  /**
   * Name the npm process in a lock this caller holds. The lock stays live while
   * npm runs, even when this caller exits first.
   */
  track(npmPid: number): void;
  /** Remove the lock only when this caller holds it. */
  release(): void;
}

/** The install lock as a file, with the start lock's code and the install lock's age limit. */
export function fileInstallLock(deps: Omit<LockDeps, "staleMs">): InstallLock {
  const held = () => {
    try {
      return (JSON.parse(deps.lockFs.read(deps.lockPath) ?? "null") as { pid?: unknown })?.pid;
    } catch {
      return undefined;
    }
  };
  const write = (extra: { npmPid?: number }) => {
    if (held() === deps.pid)
      deps.lockFs.replace(
        deps.lockPath,
        JSON.stringify({ pid: deps.pid, at: deps.now(), ...extra })
      );
  };
  return {
    take: () => takeStartLock({ ...deps, staleMs: INSTALL_LOCK_STALE_MS }),
    refresh: () => write({}),
    track: (npmPid) => write({ npmPid }),
    release: () => removeStartLockFor(deps.pid, deps.lockPath, deps.lockFs),
  };
}

export interface GuardedInstallDeps {
  lock: InstallLock;
  /** The version in the global install's `package.json`, or null. */
  globalVersion: () => string | null;
  /** The install check of the global install: a missing part, or null when complete. */
  installProblem: () => string | null;
  /** One `npm install -g om-memory-system@<target>`; `started` gets npm's process id. */
  install: (target: string, started: (npmPid: number) => void) => Promise<InstallResult>;
}

export interface GuardedResult extends InstallResult {
  /** Whether npm ran: `skipped` when another caller had installed the release already. */
  npm?: "ran" | "skipped" | "repaired";
  /** The dependency or file the install check found missing. A name, never a path. */
  missing?: string;
}

/** Settles when the install this process runs ends; null while none runs. */
let running: Promise<void> | null = null;

/**
 * `exit`, delayed until the install this process runs has ended, at most by
 * `limitMs`. Under a login item the service manager ends every process of the
 * item when the web app exits, so an early exit would stop npm mid-write.
 */
export function exitAfterInstall(
  exit: (code: number) => void,
  limitMs = INSTALL_LOCK_STALE_MS
): (code: number) => void {
  return (code) => {
    if (!running) return exit(code);
    void installEnded(limitMs).then(() => exit(code));
  };
}

/** Settles when the install this process runs has ended, at most after `limitMs`; at once when none runs. */
export function installEnded(limitMs = INSTALL_LOCK_STALE_MS): Promise<void> {
  if (!running) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => (timer = setTimeout(resolve, limitMs)));
  return Promise.race([running, limit]).then(() => clearTimeout(timer));
}

/**
 * Install `target` under the lock, check it, and repair it once. Codes:
 * `install-busy` (another caller holds the lock), npm's own codes,
 * `version-mismatch`, and `incomplete-install` (still incomplete after the repair).
 */
export async function guardedInstall(
  deps: GuardedInstallDeps,
  target: string
): Promise<GuardedResult> {
  if (!deps.lock.take()) return { code: "install-busy" };
  let ended = () => {};
  running = new Promise<void>((resolve) => (ended = resolve));
  const track = (npmPid: number) => deps.lock.track(npmPid);
  try {
    // Another caller may have finished while this one waited for its check.
    if (deps.globalVersion() === target && deps.installProblem() === null)
      return { code: null, npm: "skipped" };
    const first = await deps.install(target, track);
    if (first.code) return first;
    if (deps.globalVersion() !== target)
      return { code: "version-mismatch", exitCode: first.exitCode };
    const missing = deps.installProblem();
    if (missing === null) return { ...first, npm: "ran" };
    // npm over the broken folder refilled it on 14 November, so one more run repairs it.
    deps.lock.refresh();
    const repair = await deps.install(target, track);
    if (repair.code || deps.globalVersion() !== target || deps.installProblem() !== null)
      return { code: "incomplete-install", exitCode: repair.exitCode, missing };
    return { ...repair, npm: "repaired", missing };
  } finally {
    deps.lock.release();
    running = null;
    ended();
  }
}
