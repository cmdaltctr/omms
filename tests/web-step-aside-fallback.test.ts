import { expect, it } from "bun:test";
import {
  leaveAfterStepAside,
  NEW_OWNER_WAIT_MS,
  type StepAsideDeps,
} from "../src/cli/web-step-aside.js";

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
