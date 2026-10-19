import { expect, it } from "bun:test";
import {
  classifyEnd,
  failedUnits,
  progressBarView,
  reloadAfterFinish,
  SETTINGS_RELOAD_FAILED,
} from "../src/lib/components/memory/import-finish";
import type { HostResult, ImportJob } from "../src/lib/components/memory/import-types";

const job = (patch: Partial<ImportJob> = {}, child: Partial<HostResult> = {}): ImportJob => ({
  id: "job-1",
  dryRun: false,
  state: "running",
  activeHost: "pi",
  hosts: [{ host: "pi", state: "running", phase: "memory", processed: 400, total: 1000, ...child }],
  ...patch,
});

it("shows memory units for the active host of a real run", () => {
  expect(progressBarView(job())).toEqual({
    host: "pi",
    phase: "memory",
    done: 400,
    total: 1000,
    percent: 40,
  });
});

it("shows profile batches apart from memory units", () => {
  const view = progressBarView(
    job(
      {},
      { phase: "profile", processed: 1000, total: 1000, profileProcessed: 2, profileTotal: 4 }
    )
  );
  expect(view).toMatchObject({ phase: "profile", done: 2, total: 4, percent: 50 });
});

it("shows no bar for a preview, an idle job, or a missing child", () => {
  expect(progressBarView(job({ dryRun: true }))).toBeNull();
  expect(progressBarView(job({ state: "done" }, { state: "done" }))).toBeNull();
  expect(progressBarView(job({ hosts: [] }))).toBeNull();
  expect(progressBarView(null)).toBeNull();
});

it("stays at 0% when a phase has no total yet", () => {
  expect(progressBarView(job({}, { processed: 0, total: 0 }))?.percent).toBe(0);
});

const done = (patch: Partial<ImportJob> = {}) => job({ state: "done", ...patch });

it("opens a dialog when a run on the page ends", () => {
  expect(classifyEnd(job(), done(), null)).toBe("dialog");
  expect(classifyEnd(job(), done({ state: "failed" }), null)).toBe("dialog");
});

it("opens a banner for a run that had already ended when the page first saw it", () => {
  expect(classifyEnd(null, done(), null)).toBe("banner");
  expect(classifyEnd(null, done({ state: "failed" }), null)).toBe("banner");
});

it("announces the same finished run only once", () => {
  expect(classifyEnd(done(), done(), null)).toBe("none");
});

it("stays silent for a dismissed run, a preview, a running job and a cancelled run", () => {
  expect(classifyEnd(null, done(), "job-1")).toBe("none");
  expect(classifyEnd(job({ dryRun: true }), done({ dryRun: true }), null)).toBe("none");
  expect(classifyEnd(null, job(), null)).toBe("none");
  expect(classifyEnd(job(), done({ state: "cancelled" }), null)).toBe("none");
  expect(classifyEnd(null, done({ state: "cancelled" }), null)).toBe("none");
});

it("sums failed memory units across hosts", () => {
  const hosts: HostResult[] = [
    { host: "pi", state: "failed", summary: { unitsFailed: 2 } },
    { host: "opencode", state: "not-run" },
  ];
  expect(failedUnits(done({ hosts }))).toBe(2);
  expect(failedUnits(done({ hosts: [], summary: { unitsFailed: 1 } }))).toBe(1);
  expect(failedUnits(null)).toBe(0);
});

it("reports a failed settings reload on OK and still refreshes the job", async () => {
  let refreshed = 0;
  const refresh = async () => {
    refreshed++;
  };
  expect(await reloadAfterFinish(async () => null, refresh)).toBe(SETTINGS_RELOAD_FAILED);
  expect(await reloadAfterFinish(async () => ({ revision: "r" }), refresh)).toBeNull();
  expect(refreshed).toBe(2);
  const failing = async () => {
    throw new Error("down");
  };
  expect(await reloadAfterFinish(async () => ({}), failing)).toBeNull();
});
