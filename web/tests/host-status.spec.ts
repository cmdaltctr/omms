import { expect, it } from "bun:test";
import {
  cardLine,
  hostStatus,
  type HostStatusInput,
} from "../src/lib/components/memory/host-status";
import type { ImportRunView } from "../src/lib/auto-import-settings";

const run = (overrides: Partial<NonNullable<ImportRunView>> = {}): ImportRunView => ({
  surface: "cli",
  state: "done",
  total: 0,
  done: 0,
  percent: 0,
  minutesLeft: null,
  paused: false,
  ...overrides,
});

const input = (overrides: Partial<HostStatusInput> = {}): HostStatusInput => ({
  host: "opencode",
  run: run(),
  pending: 0,
  cutoff: Date.UTC(2026, 8, 28),
  runNowUnavailable: null,
  setUp: true,
  formatDate: (ms) => new Date(ms).toISOString().slice(0, 10),
  ...overrides,
});

it("reports a host that is not set up and offers setup steps instead of an import", () => {
  const status = hostStatus(input({ setUp: false, run: null }));
  expect(status.state).toBe("not-set-up");
  expect(status.action).toEqual({ kind: "setup", enabled: true });
  expect(status.sentence.text).toBe("This host is not set up on this machine.");
});

it("shows Pause and progress while a run is going", () => {
  const status = hostStatus(
    input({ run: run({ state: "running", total: 431, done: 120, percent: 27, minutesLeft: 6 }) })
  );
  expect(status.state).toBe("running");
  expect(status.action).toEqual({ kind: "pause", enabled: true });
  expect(status.sentence.text).toBe("Importing {done} / {total}. About {minutes} min left.");
  expect(status.sentence.params).toEqual({ done: 120, total: 431, minutes: 6 });
});

it("leaves the time left out when it is unknown", () => {
  const status = hostStatus(input({ run: run({ state: "running", total: 10, done: 1 }) }));
  expect(status.sentence.text).toBe("Importing {done} / {total}.");
});

it("shows Resume for a paused host when nothing blocks it", () => {
  const status = hostStatus(input({ run: run({ paused: true, state: "stopped" }) }));
  expect(status.state).toBe("paused");
  expect(status.action).toEqual({ kind: "resume", enabled: true });
  expect(status.sentence.text).toBe("Paused. Resume to continue.");
  expect(status.offerExternal).toBe(false);
});

it("greys out Resume with the reason and offers the external API when the model needs the host open", () => {
  const reason = "Open OpenCode, or choose the external API for OpenCode's backfill";
  const status = hostStatus(
    input({ run: run({ paused: true, state: "stopped" }), runNowUnavailable: reason })
  );
  expect(status.state).toBe("paused");
  expect(status.action).toEqual({ kind: "resume", enabled: false });
  expect(status.sentence).toEqual({ text: "{reason}", params: { reason } });
  expect(status.offerExternal).toBe(true);
});

it("does not offer the external API shortcut for Claude Code, which only has the external API", () => {
  const status = hostStatus(
    input({
      host: "claude-code",
      run: run({ paused: true, state: "stopped" }),
      runNowUnavailable: "memoryApiKey is not set",
    })
  );
  expect(status.action.enabled).toBe(false);
  expect(status.offerExternal).toBe(false);
});

it("shows Retry and the redacted reason after a failed run", () => {
  const status = hostStatus(
    input({ run: run({ state: "failed", error: "model call failed (401)" }) })
  );
  expect(status.state).toBe("failed");
  expect(status.action).toEqual({ kind: "retry", enabled: true });
  expect(status.sentence.text).toBe("Stopped: {error}");
  expect(status.sentence.params).toEqual({ error: "model call failed (401)" });
});

it("reads Running with Pause and says nothing waited before the cutoff after a finished run with no work", () => {
  const status = hostStatus(input({ run: run({ state: "done", total: 0 }) }));
  expect(status.state).toBe("running");
  expect(status.action).toEqual({ kind: "pause", enabled: true });
  expect(status.sentence.text).toBe(
    "Automatic import is on. Nothing was waiting before {date}. Use Sessions below for newer chats."
  );
  expect(status.sentence.params).toEqual({ date: "2026-09-28" });
});

it("reads Running with Pause and says nothing is waiting when no cutoff is known", () => {
  const status = hostStatus(input({ cutoff: null, run: run({ state: "done", total: 0 }) }));
  expect(status.state).toBe("running");
  expect(status.sentence.text).toBe("Automatic import is on. Nothing is waiting.");
});

it("reads Running with Pause after a run that did work, and leaves the counts to the details below", () => {
  const status = hostStatus(
    input({
      pending: 0,
      run: run({ state: "done", total: 431, done: 431, imported: 400, skipped: 30, failed: 1 }),
    })
  );
  expect(status.state).toBe("running");
  expect(status.action).toEqual({ kind: "pause", enabled: true });
  expect(status.sentence).toEqual({ text: "Automatic import is on. Nothing is waiting." });
});

it("says how many exchanges still wait when a finished or stopped run left some", () => {
  for (const state of ["done", "stopped"]) {
    const status = hostStatus(input({ pending: 12, run: run({ state, total: 50, done: 38 }) }));
    expect(status.sentence).toEqual({
      text: "{pending} still waiting to import.",
      params: { pending: 12 },
    });
  }
});

it("calls a run that stopped with work left stopped, and offers Resume", () => {
  const status = hostStatus(
    input({ pending: 12, run: run({ state: "stopped", total: 50, done: 38, imported: 38 }) })
  );
  expect(status.state).toBe("stopped");
  expect(status.action).toEqual({ kind: "resume", enabled: true });
});

it("reads Running when a run stopped with nothing left to import", () => {
  const status = hostStatus(input({ pending: 0, run: run({ state: "stopped", total: 5 }) }));
  expect(status.state).toBe("running");
  expect(status.action.kind).toBe("pause");
});

it("calls an idle host stopped, with the reason, when it must be open", () => {
  const reason = "Open Pi, or choose the external API for Pi's backfill";
  const status = hostStatus(input({ host: "pi", run: run(), runNowUnavailable: reason }));
  expect(status.state).toBe("stopped");
  expect(status.action).toEqual({ kind: "resume", enabled: false });
  expect(status.sentence.params).toEqual({ reason });
  expect(status.offerExternal).toBe(true);
});

it("treats a host with no run record as running, because automatic import is on", () => {
  for (const value of [null, run({ state: null })]) {
    const status = hostStatus(input({ run: value }));
    expect(status.state).toBe("running");
    expect(status.action).toEqual({ kind: "pause", enabled: true });
  }
});

it("never offers Run now for any run record", () => {
  const runs = [null, run({ state: "done" }), run({ state: "stopped" }), run({ state: "failed" })];
  for (const value of runs) {
    expect(hostStatus(input({ run: value, pending: 2 })).action.kind).not.toBe("run" as never);
  }
});

it("builds the one-line card status for each state", () => {
  const line = (overrides: Partial<HostStatusInput>) => cardLine(input(overrides));
  expect(line({ setUp: false, run: null })).toEqual({ text: "Not set up" });
  expect(line({ run: run({ state: "running", percent: 27, total: 10 }) })).toEqual({
    text: "Importing · {percent}%",
    params: { percent: 27 },
  });
  expect(line({ pending: 0, run: run({ paused: true, state: "stopped" }) })).toEqual({
    text: "Paused · {pending} pending",
    params: { pending: 0 },
  });
  expect(line({ run: run({ state: "failed" }) })).toEqual({ text: "Failed" });
  expect(line({ pending: 3, run: run({ state: "stopped", total: 5 }) })).toEqual({
    text: "Stopped · {pending} pending",
    params: { pending: 3 },
  });
  expect(line({ run: run({ state: "done", updatedAt: Date.UTC(2026, 9, 9) }) })).toEqual({
    text: "Running · last import {date}",
    params: { date: "2026-10-09" },
  });
  expect(line({ run: null })).toEqual({ text: "Running" });
});

it("shows a pause that is still being honoured as running with Pause unavailable", () => {
  const status = hostStatus(
    input({ run: run({ state: "running", paused: true, total: 9, done: 2 }) })
  );
  expect(status.state).toBe("running");
  expect(status.action).toEqual({ kind: "pause", enabled: false });
  expect(status.sentence.text).toBe("Pausing after the current exchange.");
});
