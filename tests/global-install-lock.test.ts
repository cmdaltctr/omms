import { afterEach, beforeEach, expect, it, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  exitAfterInstall,
  fileInstallLock,
  guardedInstall,
  INSTALL_LOCK_STALE_MS,
  installLockPath,
  type GuardedInstallDeps,
} from "../src/services/global-install.js";
import { nodeLockFs, processAlive } from "../src/services/web-ensure.js";
import type { InstallResult } from "../src/services/web-update.js";

// The install lock, the check under it, and the one repair. Every lock lives in
// a temp folder and npm is a fake, so nothing touches a real global install.

setDefaultTimeout(30_000);

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "omms-install-lock-"));
});
const sleepers: { kill(): void }[] = [];

afterEach(() => {
  for (const proc of sleepers.splice(0)) proc.kill();
  rmSync(home, { recursive: true, force: true });
});

const lockPath = () => installLockPath(home);

function lock(
  options: { pid?: number; now?: () => number; alive?: (pid: number) => boolean } = {}
) {
  return fileInstallLock({
    lockPath: lockPath(),
    lockFs: nodeLockFs,
    pid: options.pid ?? process.pid,
    now: options.now ?? Date.now,
    pidAlive: options.alive ?? (() => true),
  });
}

/**
 * A fake global install at 6.4.0. Each npm run in `npm` says how it ends: "ok"
 * installs 6.5.0 complete, "empty" installs 6.5.0 with an empty `js-base64`
 * folder, or an npm failure code.
 */
function fake(npm: ("ok" | "empty" | string)[], options: { version?: string } = {}) {
  const state = { version: options.version ?? "6.4.0", problem: null as string | null, runs: 0 };
  const deps: GuardedInstallDeps = {
    lock: lock(),
    globalVersion: () => state.version,
    installProblem: () => state.problem,
    install: async (target): Promise<InstallResult> => {
      const end = npm[state.runs++] ?? "ok";
      if (end !== "ok" && end !== "empty") return { code: end, exitCode: 1 };
      state.version = target;
      state.problem = end === "empty" ? "js-base64" : null;
      return { code: null, exitCode: 0 };
    },
  };
  return { deps, state };
}

const lockFile = () => {
  try {
    return readFileSync(lockPath(), "utf8");
  } catch {
    return null;
  }
};

it("runs npm once for a complete install and releases the lock", async () => {
  const f = fake(["ok"]);
  expect(await guardedInstall(f.deps, "6.5.0")).toEqual({ code: null, exitCode: 0, npm: "ran" });
  expect(f.state.runs).toBe(1);
  expect(lockFile()).toBeNull();
});

it("repairs an empty dependency folder with one more install", async () => {
  const f = fake(["empty", "ok"]);
  expect(await guardedInstall(f.deps, "6.5.0")).toEqual({
    code: null,
    exitCode: 0,
    npm: "repaired",
    missing: "js-base64",
  });
  expect(f.state.runs).toBe(2);
  expect(lockFile()).toBeNull();
});

it("reports incomplete-install when the repair leaves the folder empty", async () => {
  const f = fake(["empty", "empty"]);
  expect(await guardedInstall(f.deps, "6.5.0")).toEqual({
    code: "incomplete-install",
    exitCode: 0,
    missing: "js-base64",
  });
  expect(f.state.runs).toBe(2);
  expect(lockFile()).toBeNull();
});

it("reports incomplete-install when npm fails during the repair", async () => {
  const f = fake(["empty", "npm-exit"]);
  expect(await guardedInstall(f.deps, "6.5.0")).toEqual({
    code: "incomplete-install",
    exitCode: 1,
    missing: "js-base64",
  });
});

it("skips npm when another caller already installed the release completely", async () => {
  const f = fake([], { version: "6.5.0" });
  expect(await guardedInstall(f.deps, "6.5.0")).toEqual({ code: null, npm: "skipped" });
  expect(f.state.runs).toBe(0);
});

it("installs again when the release is there but incomplete", async () => {
  const f = fake(["ok"], { version: "6.5.0" });
  f.state.problem = "js-base64";
  expect(await guardedInstall(f.deps, "6.5.0")).toMatchObject({ code: null, npm: "ran" });
  expect(f.state.runs).toBe(1);
});

it("releases the lock after an npm failure and after a version mismatch", async () => {
  const failed = fake(["timeout"]);
  expect(await guardedInstall(failed.deps, "6.5.0")).toEqual({ code: "timeout", exitCode: 1 });
  expect(lockFile()).toBeNull();
  const mismatch = fake(["ok"]);
  mismatch.deps.globalVersion = () => "6.4.0";
  expect(await guardedInstall(mismatch.deps, "6.5.0")).toEqual({
    code: "version-mismatch",
    exitCode: 0,
  });
  expect(lockFile()).toBeNull();
});

it("gives a second concurrent caller install-busy while npm runs, and runs npm once", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const f = fake([]);
  const slow = {
    ...f.deps,
    install: async (target: string) => (await gate, f.deps.install(target, () => {})),
  };
  const first = guardedInstall(slow, "6.5.0");
  const second = await guardedInstall({ ...slow, lock: lock() }, "6.5.0");
  expect(second).toEqual({ code: "install-busy" });
  release();
  expect(await first).toMatchObject({ code: null, npm: "ran" });
  expect(f.state.runs).toBe(1);
});

it("takes over a lock whose holder has exited", async () => {
  mkdirSync(join(home, ".omms"), { recursive: true });
  writeFileSync(lockPath(), JSON.stringify({ pid: 999_999, at: Date.now() }));
  const f = fake(["ok"]);
  f.deps.lock = lock({ alive: (pid) => pid !== 999_999 });
  expect(await guardedInstall(f.deps, "6.5.0")).toMatchObject({ code: null, npm: "ran" });
});

it("waits out a live holder until its lock is 6 minutes old, then takes it over", async () => {
  mkdirSync(join(home, ".omms"), { recursive: true });
  const at = 1_000_000;
  writeFileSync(lockPath(), JSON.stringify({ pid: 4242, at }));
  const young = fake([]);
  young.deps.lock = lock({ now: () => at + INSTALL_LOCK_STALE_MS });
  expect(await guardedInstall(young.deps, "6.5.0")).toEqual({ code: "install-busy" });
  // The 5-minute npm timeout ends a hung holder first, so 6 minutes is enough.
  expect(INSTALL_LOCK_STALE_MS).toBe(6 * 60 * 1000);
  const old = fake(["ok"]);
  old.deps.lock = lock({ now: () => at + INSTALL_LOCK_STALE_MS + 1 });
  expect(await guardedInstall(old.deps, "6.5.0")).toMatchObject({ code: null, npm: "ran" });
});

it("refreshes the lock time before the repair, so the repair is not run under a stale lock", async () => {
  let clock = 0;
  const seen: unknown[] = [];
  const f = fake(["empty", "ok"]);
  f.deps.lock = lock({ now: () => clock });
  const install = f.deps.install;
  f.deps.install = async (target) => {
    seen.push(JSON.parse(lockFile() ?? "null")?.at);
    clock += 5 * 60 * 1000;
    return install(target);
  };
  await guardedInstall(f.deps, "6.5.0");
  expect(seen).toEqual([0, 5 * 60 * 1000]);
});

/** A real process that sleeps, for a live process id. Runs on every system; `afterEach` kills it. */
function sleeper() {
  const proc = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30000)"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  sleepers.push(proc);
  return proc;
}

it("keeps the lock while npm runs after its holder exited, then lets the next caller skip npm", async () => {
  const holder = sleeper();
  const npm = sleeper();
  let finishNpm = () => {};
  const npmDone = new Promise<void>((resolve) => (finishNpm = resolve));
  const f = fake([]);
  f.deps.lock = fileInstallLock({
    lockPath: lockPath(),
    lockFs: nodeLockFs,
    pid: holder.pid,
    now: Date.now,
    pidAlive: processAlive,
  });
  // The holder's npm writes the release; it is still running when the holder exits.
  f.deps.install = async (target, started) => {
    started?.(npm.pid);
    await npmDone;
    f.state.version = target;
    return { code: null, exitCode: 0 };
  };
  void guardedInstall(f.deps, "6.5.0");
  holder.kill();
  await holder.exited;

  // The web app exited mid-install; its npm still writes, so nobody else may run npm.
  const next = fake(["ok"]);
  next.deps.lock = fileInstallLock({
    lockPath: lockPath(),
    lockFs: nodeLockFs,
    pid: process.pid,
    now: Date.now,
    pidAlive: processAlive,
  });
  next.deps.globalVersion = () => f.state.version;
  expect(await guardedInstall(next.deps, "6.5.0")).toEqual({ code: "install-busy" });
  expect(next.state.runs).toBe(0);

  // npm finishes on its own after the holder has gone.
  finishNpm();
  await Promise.resolve();
  npm.kill();
  await npm.exited;
  expect(f.state.version).toBe("6.5.0");
  expect(await guardedInstall(next.deps, "6.5.0")).toEqual({ code: null, npm: "skipped" });
  expect(next.state.runs).toBe(0);
});

it("lets an exit wait for an install in progress, at most for its limit", async () => {
  const exits: number[] = [];
  const exit = exitAfterInstall((code) => exits.push(code));
  exit(0);
  expect(exits).toEqual([0]);

  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const f = fake([]);
  const slow = {
    ...f.deps,
    install: async (target: string) => (await gate, f.deps.install(target, () => {})),
  };
  const running = guardedInstall(slow, "6.5.0");
  exit(0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(exits).toEqual([0]);
  release();
  await running;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(exits).toEqual([0, 0]);

  // A hung install holds the exit only up to the limit.
  const hung = fake([]);
  void guardedInstall({ ...hung.deps, install: () => new Promise(() => {}) }, "6.5.0");
  exitAfterInstall((code) => exits.push(code), 30)(3);
  expect(exits).toEqual([0, 0]);
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(exits).toEqual([0, 0, 3]);
});

it("lets exactly one of several processes run npm at once", async () => {
  // Each caller runs under this test's runtime (Bun), which loads the TypeScript source,
  // so the test checks the current code and needs no build.
  const source = (file: string) =>
    pathToFileURL(join(import.meta.dir, "..", "src", "services", file)).href;
  const runs = join(home, "npm-runs");
  const go = join(home, "go");
  const version = join(home, "global-version");
  writeFileSync(version, "6.4.0");
  const script = join(home, "caller.mjs");
  writeFileSync(
    script,
    `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const { fileInstallLock, guardedInstall, installLockPath } = await import(${JSON.stringify(source("global-install.ts"))});
const { nodeLockFs, processAlive } = await import(${JSON.stringify(source("web-ensure.ts"))});
while (!existsSync(${JSON.stringify(go)})) await new Promise((r) => setTimeout(r, 1));
const result = await guardedInstall({
  lock: fileInstallLock({ lockPath: installLockPath(${JSON.stringify(home)}), lockFs: nodeLockFs, pid: process.pid, now: Date.now, pidAlive: processAlive }),
  globalVersion: () => readFileSync(${JSON.stringify(version)}, "utf8"),
  installProblem: () => null,
  install: async (target) => {
    appendFileSync(${JSON.stringify(runs)}, process.pid + "\\n");
    // A slow npm: every other caller arrives while it runs.
    await new Promise((r) => setTimeout(r, 1500));
    writeFileSync(${JSON.stringify(version)}, target);
    return { code: null, exitCode: 0 };
  },
}, "6.5.0");
console.log(JSON.stringify(result));
`
  );
  const callers = Array.from({ length: 4 }, () =>
    Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" })
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
      if (code !== 0) throw new Error(`caller exited ${code}: ${err.trim().slice(0, 800)}`);
      return JSON.parse(out.trim()) as { code: string | null; npm?: string };
    })
  );
  expect(readFileSync(runs, "utf8").trim().split("\n")).toHaveLength(1);
  expect(results.filter((result) => result.npm === "ran")).toHaveLength(1);
  expect(results.filter((result) => result.code === "install-busy")).toHaveLength(3);
  expect(lockFile()).toBeNull();
});
