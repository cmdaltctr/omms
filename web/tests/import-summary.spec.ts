import { expect, it } from "bun:test";
import { importSummary } from "../src/lib/components/memory/import-summary";
import type { ImportJob } from "../src/lib/components/memory/import-types";

const profile = (promptsRecorded: number, failed = false) => ({
  promptsRecorded,
  promptsWouldRecord: 0,
  batchesBuilt: 1,
  remaining: 0,
  failed,
});

function job(children: Record<string, unknown>[]) {
  return { id: "j", dryRun: false, state: "done", hosts: children } as unknown as ImportJob;
}

it("sums saved memories, profile prompts and failed units over the hosts", () => {
  const result = importSummary(
    job([
      { host: "pi", summary: { unitsImported: 7, unitsFailed: 1, profile: profile(12) } },
      { host: "opencode", summary: { unitsImported: 5, unitsFailed: 0, profile: profile(8) } },
    ])
  );
  expect(result).toEqual({
    saved: 12,
    profilePrompts: 20,
    failedUnits: 1,
    profileFailed: false,
    failed: true,
  });
});

it("is not failed when every unit and the profile step succeeded", () => {
  const result = importSummary(
    job([{ host: "pi", summary: { unitsImported: 3, unitsFailed: 0, profile: profile(4) } }])
  );
  expect(result).toMatchObject({ failedUnits: 0, profileFailed: false, failed: false });
});

it("is failed when only the profile step failed", () => {
  const result = importSummary(
    job([{ host: "pi", summary: { unitsImported: 3, unitsFailed: 0, profile: profile(0, true) } }])
  );
  expect(result).toMatchObject({ failedUnits: 0, profileFailed: true, failed: true });
});

it("reads a host with no summary or no profile as zero", () => {
  const result = importSummary(
    job([{ host: "pi" }, { host: "opencode", summary: { unitsImported: 2 } }])
  );
  expect(result).toEqual({
    saved: 2,
    profilePrompts: 0,
    failedUnits: 0,
    profileFailed: false,
    failed: false,
  });
});

it("reads the top-level summary of a job with no host rows", () => {
  const single = {
    id: "j",
    dryRun: false,
    state: "done",
    summary: { unitsImported: 9, unitsFailed: 2, profile: profile(6) },
  } as unknown as ImportJob;
  expect(importSummary(single)).toEqual({
    saved: 9,
    profilePrompts: 6,
    failedUnits: 2,
    profileFailed: false,
    failed: true,
  });
});
