import { expect, it } from "bun:test";
import {
  hostsWithWork,
  importEstimate,
  nothingToImport,
} from "../src/lib/components/memory/import-estimate";
import type { ImportJob } from "../src/lib/components/memory/import-types";

const MINUTE = 60_000;

/** A finished run record, as `/api/settings/backfill/runs` reports it. */
function run(done: number, minutes: number, state = "done") {
  return {
    run: { state, done, startedAt: 1_000_000, updatedAt: 1_000_000 + minutes * MINUTE },
  } as never;
}

/** A dry-run job with one child per host. */
function preview(hosts: Record<string, { units: number; sessions: number }>, profileCalls = 0) {
  return {
    id: "j",
    dryRun: true,
    state: "done",
    profileEstimate: { analysisCalls: profileCalls },
    hosts: Object.entries(hosts).map(([host, part]) => ({
      host,
      state: "done",
      sessions: part.sessions,
      summary: { unitsWouldImport: part.units },
    })),
  } as unknown as ImportJob;
}

it("counts calls as units plus profile calls and times them from the last Pi run", () => {
  const job = preview({ pi: { units: 40, sessions: 9 } }, 2);
  // 60 units in 30 minutes is 2 a minute; 42 calls take 21 minutes.
  expect(importEstimate(job, { pi: run(60, 30) } as never)).toEqual({
    sessions: 9,
    calls: 42,
    minutes: 21,
  });
});

it("rounds the minutes up", () => {
  const job = preview({ pi: { units: 41, sessions: 1 } }, 0);
  expect(importEstimate(job, { pi: run(60, 30) } as never).minutes).toBe(21);
});

it("gives no minutes when the last run was under 5 units", () => {
  const job = preview({ pi: { units: 40, sessions: 9 } }, 2);
  expect(importEstimate(job, { pi: run(4, 30) } as never).minutes).toBeNull();
  expect(importEstimate(job, { pi: run(5, 30) } as never).minutes).not.toBeNull();
});

it("gives no minutes when the last run was under one minute", () => {
  const job = preview({ pi: { units: 40, sessions: 9 } }, 2);
  expect(importEstimate(job, { pi: run(60, 59 / 60) } as never).minutes).toBeNull();
  expect(importEstimate(job, { pi: run(60, 1) } as never).minutes).not.toBeNull();
});

it("gives no minutes when no run is known, or the run did not finish", () => {
  const job = preview({ pi: { units: 40, sessions: 9 } }, 2);
  expect(importEstimate(job, undefined).minutes).toBeNull();
  expect(importEstimate(job, { pi: null } as never).minutes).toBeNull();
  expect(importEstimate(job, { pi: run(60, 30, "failed") } as never).minutes).toBeNull();
  expect(importEstimate(job, { pi: run(60, 30, "running") } as never).minutes).toBeNull();
});

it("adds each host's own time, because the server runs hosts one after another", () => {
  const job = preview({ pi: { units: 30, sessions: 3 }, opencode: { units: 30, sessions: 4 } });
  // Pi: 30 calls at 2 a minute is 15 min. OpenCode: 30 calls at 1 a minute is 30 min.
  const runs = { pi: run(60, 30), opencode: run(30, 30), "claude-code": run(600, 10) } as never;
  expect(importEstimate(job, runs)).toEqual({ sessions: 7, calls: 60, minutes: 45 });
});

it("gives no minutes when any host with work has no known speed", () => {
  const job = preview({ pi: { units: 30, sessions: 3 }, opencode: { units: 30, sessions: 4 } });
  expect(
    importEstimate(job, { pi: run(60, 30), opencode: run(2, 30) } as never).minutes
  ).toBeNull();
  expect(importEstimate(job, { pi: run(60, 30) } as never).minutes).toBeNull();
});

it("ignores a host with no work when it has no known speed", () => {
  const job = preview({ pi: { units: 30, sessions: 3 }, opencode: { units: 0, sessions: 0 } });
  expect(importEstimate(job, { pi: run(60, 30) } as never).minutes).toBe(15);
});

it("counts each host's own profile calls at that host's speed", () => {
  const job = preview({ pi: { units: 10, sessions: 1 }, opencode: { units: 10, sessions: 1 } }, 4);
  job.hosts![0]!.profileEstimate = { analysisCalls: 2 } as never;
  job.hosts![1]!.profileEstimate = { analysisCalls: 2 } as never;
  // Pi: 12 calls at 2 a minute is 6 min. OpenCode: 12 calls at 1 a minute is 12 min.
  const runs = { pi: run(60, 30), opencode: run(30, 30) } as never;
  expect(importEstimate(job, runs)).toEqual({ sessions: 2, calls: 24, minutes: 18 });
});

it("never shows 0 minutes for real work", () => {
  const job = preview({ pi: { units: 1, sessions: 1 } });
  expect(importEstimate(job, { pi: run(600, 1) } as never).minutes).toBe(1);
});

it("reads a job with no host rows from its own counts", () => {
  const job = {
    id: "j",
    dryRun: true,
    state: "done",
    sessions: 5,
    summary: { unitsWouldImport: 10 },
    profileEstimate: { analysisCalls: 2 },
  } as unknown as ImportJob;
  expect(importEstimate(job, undefined)).toEqual({ sessions: 5, calls: 12, minutes: null });
});

it("says there is nothing to import only when every count is zero", () => {
  const empty = preview({ pi: { units: 0, sessions: 0 } });
  expect(nothingToImport(empty)).toBe(true);
  expect(nothingToImport(preview({ pi: { units: 0, sessions: 2 } }))).toBe(false);
  expect(nothingToImport(preview({ pi: { units: 1, sessions: 0 } }))).toBe(false);
  const skills = preview({ pi: { units: 0, sessions: 0 } });
  skills.hosts![0]!.summary = { unitsWouldImport: 0, skillTurnsWouldRecord: 3 };
  expect(nothingToImport(skills)).toBe(false);
});

// The server runs no host with zero sessions, so waiting profile prompts alone start no call.
it("counts waiting profile prompts only when a host has sessions to run", () => {
  const waitingOnly = preview({ pi: { units: 0, sessions: 0 } }, 1);
  expect(nothingToImport(waitingOnly)).toBe(true);
  expect(importEstimate(waitingOnly, undefined).calls).toBe(0);
  const withSessions = preview({ pi: { units: 0, sessions: 2 } }, 1);
  expect(nothingToImport(withSessions)).toBe(false);
  expect(importEstimate(withSessions, undefined).calls).toBe(1);
});

it("names only the hosts the preview found work for", () => {
  const job = preview({ pi: { units: 0, sessions: 0 }, "claude-code": { units: 3, sessions: 1 } });
  job.hosts![0]!.state = "no-work";
  expect(hostsWithWork(job)).toEqual(["claude-code"]);
});

it("times the shared profile calls on the first host that runs, not on a host with no work", () => {
  const job = preview(
    { pi: { units: 0, sessions: 0 }, "claude-code": { units: 3, sessions: 1 } },
    1
  );
  job.hosts![0]!.state = "no-work";
  // Claude Code: 3 units plus the 1 shared profile call at 2 a minute is 2 min.
  expect(importEstimate(job, { "claude-code": run(60, 30) } as never)).toEqual({
    sessions: 1,
    calls: 4,
    minutes: 2,
  });
});
