import { expect, it } from "bun:test";
import { restorableJob } from "../src/lib/components/memory/import-job-view";
import type { ImportJob } from "../src/lib/components/memory/import-types";

const job = (state: string) => ({ id: "j", dryRun: false, state }) as ImportJob;

it("restores an active job after a reload", () => {
  for (const state of ["queued", "preparing", "running", "cancelling"]) {
    expect(restorableJob(job(state))?.state).toBe(state);
  }
});

it("drops a finished, failed or cancelled job after a reload", () => {
  for (const state of ["done", "failed", "cancelled"]) {
    expect(restorableJob(job(state))).toBeNull();
  }
});

it("returns null when the server has no job", () => {
  expect(restorableJob(null)).toBeNull();
});
