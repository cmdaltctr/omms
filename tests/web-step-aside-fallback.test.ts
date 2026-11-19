import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  leaveAfterStepAside,
  NEW_OWNER_WAIT_MS,
  type StepAsideDeps,
} from "../src/cli/web-step-aside.js";
import {
  fileInstallLock,
  guardedInstall,
  installLockPath,
} from "../src/services/global-install.js";
import { nodeLockFs } from "../src/services/web-ensure.js";

// After a standalone web app steps aside, the caller's copy should take the port.
// When the caller quits first, the old web app restarts onto the newest copy.

function fake(config: { answers?: boolean[]; restartCode?: string; resumeThrows?: boolean }) {
  const answers = [...(config.answers ?? [])];
  const calls: string[] = [];
  const clock = { ms: 0 };
  const deps: StepAsideDeps = {
    // Each poll reads the next answer; once the list ends, nobody answers.
    ownerAnswers: async () => answers.shift() ?? false,
    restartNewest: async () => {
      calls.push("restart");
      return config.restartCode;
    },
    resume: async () => {
      calls.push("resume");
      if (config.resumeThrows) throw new Error("port busy");
    },
    sleep: async (ms) => {
      clock.ms += ms;
    },
    now: () => clock.ms,
    exit: (code) => calls.push(`exit ${code}`),
    log: (_message, data) => calls.push(`log ${String(data.code)}`),
  };
  return { deps, calls, clock };
}

it("exits once the caller's copy answers on the port", async () => {
  const f = fake({ answers: [false, false, true] });
  await leaveAfterStepAside(f.deps);
  expect(f.calls).toEqual(["exit 0"]);
});

it("restarts onto the newest copy when no new owner comes", async () => {
  const f = fake({});
  await leaveAfterStepAside(f.deps);
  expect(f.calls).toEqual(["log no-new-owner", "restart"]);
  expect(f.clock.ms).toBeGreaterThanOrEqual(NEW_OWNER_WAIT_MS);
});

it("serves again when the restart fails and the port stays empty", async () => {
  const f = fake({ restartCode: "no-launcher" });
  await leaveAfterStepAside(f.deps);
  expect(f.calls).toEqual(["log no-new-owner", "restart", "resume"]);
});

it("exits with 1 when it cannot serve again either", async () => {
  const f = fake({ restartCode: "spawn-error", resumeThrows: true });
  await leaveAfterStepAside(f.deps);
  expect(f.calls).toEqual(["log no-new-owner", "restart", "resume", "log resume-failed", "exit 1"]);
});

it("waits for an install in progress before it exits, as for a step-aside or a retire", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const home = mkdtempSync(join(tmpdir(), "omms-aside-install-"));
  const install = guardedInstall(
    {
      lock: fileInstallLock({
        lockPath: installLockPath(home),
        lockFs: nodeLockFs,
        pid: process.pid,
        now: Date.now,
        pidAlive: () => true,
      }),
      globalVersion: () => "4.8.0",
      installProblem: () => null,
      install: async () => (await gate, { code: null, exitCode: 0 }),
    },
    "4.9.0"
  );
  const f = fake({ answers: [true] });
  await leaveAfterStepAside(f.deps);
  // npm still writes the global install, so the process must not exit yet.
  expect(f.calls).toEqual([]);
  release();
  await install;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.calls).toEqual(["exit 0"]);
  rmSync(home, { recursive: true, force: true });
});

it("waits for an install in progress before it restarts the service when no new owner comes", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const home = mkdtempSync(join(tmpdir(), "omms-aside-restart-"));
  const install = guardedInstall(
    {
      lock: fileInstallLock({
        lockPath: installLockPath(home),
        lockFs: nodeLockFs,
        pid: process.pid,
        now: Date.now,
        pidAlive: () => true,
      }),
      globalVersion: () => "4.8.0",
      installProblem: () => null,
      install: async () => (await gate, { code: "npm-failed", exitCode: 1 }),
    },
    "4.9.0"
  );
  const f = fake({});
  const leaving = leaveAfterStepAside(f.deps);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // A service restart now would stop npm mid-write.
  expect(f.calls).toEqual(["log no-new-owner"]);
  release();
  await install;
  await leaving;
  // The update failed and nobody serves: the fallback restart runs after the install.
  expect(f.calls).toEqual(["log no-new-owner", "restart"]);
  rmSync(home, { recursive: true, force: true });
});

// An update restarts the login item with `kickstart -k`, which launchd can hold for its
// 30-second throttle; the update then gives the new copy FRESH_WAIT_MS to answer. An old
// web app that gave up sooner restarted the login item again and killed the new copy.
it("waits for a new owner at least as long as an update restart can take", async () => {
  const { FRESH_WAIT_MS } = await import("../src/cli/web-update-command.js");
  const { LOGIN_ITEM_THROTTLE_MS } = await import("../src/services/web-autostart.js");
  expect(NEW_OWNER_WAIT_MS).toBeGreaterThan(LOGIN_ITEM_THROTTLE_MS + FRESH_WAIT_MS);
});
