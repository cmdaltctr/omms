import { expect, it } from "bun:test";
import { jobForHost } from "../src/lib/components/memory/import-job-view";
import type { ImportJob } from "../src/lib/components/memory/import-types";

const summary = (unitsImported: number) => ({ unitsImported }) as ImportJob["summary"];

const claudeJob: ImportJob = {
  id: "synthetic-claude",
  dryRun: false,
  state: "done",
  summary: summary(142),
  hosts: [{ host: "claude-code", state: "done", summary: summary(142) }],
};

it("hides another host's job on a host tab", () => {
  expect(jobForHost(claudeJob, "opencode")).toBeNull();
});

it("shows the job on the host that ran it", () => {
  expect(jobForHost(claudeJob, "claude-code")).toBe(claudeJob);
});

it("keeps every host on the overview", () => {
  expect(jobForHost(claudeJob, undefined)).toBe(claudeJob);
});

it("shows only this host's counts when one job ran several hosts", () => {
  const both: ImportJob = {
    id: "synthetic-both",
    dryRun: false,
    state: "done",
    summary: summary(200),
    hosts: [
      { host: "opencode", state: "done", summary: summary(58) },
      { host: "claude-code", state: "done", summary: summary(142) },
    ],
  };
  const view = jobForHost(both, "claude-code");
  expect(view?.hosts?.map((child) => child.host)).toEqual(["claude-code"]);
  expect(view?.summary?.unitsImported).toBe(142);
});

it("matches a single-host job that only carries `host`", () => {
  const single: ImportJob = { id: "s", dryRun: true, state: "done", host: "pi" };
  expect(jobForHost(single, "pi")).toBe(single);
  expect(jobForHost(single, "opencode")).toBeNull();
});

it("passes a missing job through", () => {
  expect(jobForHost(null, "pi")).toBeNull();
});

const failedGroup = (): ImportJob => ({
  id: "synthetic-failed",
  dryRun: false,
  state: "failed",
  activeHost: "opencode",
  error: "OpenCode: model refused",
  hosts: [
    { host: "opencode", state: "failed", error: "OpenCode: model refused" },
    { host: "claude-code", state: "not-run" },
  ],
});

it("shows the host's own state, not the failed group's, on a later host", () => {
  const view = jobForHost(failedGroup(), "claude-code");
  expect(view?.state).toBe("not-run");
  expect(view?.error).toBeUndefined();
  expect(view?.activeHost).toBeNull();
});

it("keeps the failure and active host on the host that failed", () => {
  const view = jobForHost(failedGroup(), "opencode");
  expect(view?.state).toBe("failed");
  expect(view?.error).toBe("OpenCode: model refused");
  expect(view?.activeHost).toBe("opencode");
});

it("keeps a group-level error when no host row failed", () => {
  const job: ImportJob = {
    id: "synthetic-prep",
    dryRun: false,
    state: "failed",
    error: "Import preparation failed.",
    hosts: [
      { host: "opencode", state: "queued" },
      { host: "claude-code", state: "queued" },
    ],
  };
  expect(jobForHost(job, "claude-code")?.error).toBe("Import preparation failed.");
});
