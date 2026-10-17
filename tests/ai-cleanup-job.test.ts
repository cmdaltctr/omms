import { afterEach, expect, it, mock } from "bun:test";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const { startAiCleanupJob, getAiCleanupJob, getAiCleanupResult, stopAiCleanupJob } =
  await import("../src/services/user-profile/ai-cleanup-job.js");

type Batch = { preferences: Array<{ id: string }>; patterns: unknown[]; workflows: unknown[] };

const pref = (i: number) => ({
  category: `c${i % 3}`,
  description: `item ${i}`,
  confidence: 0.5,
  frequency: 1,
  lastSeen: 1,
});
const profileData = {
  preferences: Array.from({ length: 5 }, (_, i) => pref(i)),
  patterns: [],
  workflows: [],
} as any;

const users: string[] = [];
function user(name: string) {
  users.push(name);
  return name;
}

afterEach(() => {
  for (const name of users.splice(0)) stopAiCleanupJob(name);
});

function noChanges(batch: Batch) {
  return Promise.resolve({
    diff: { kept: batch.preferences.map((p) => p.id), merged: [], removed: [] },
    mergedItems: {},
  });
}

/** A batch call that waits until the test lets it finish. */
function gate() {
  const waiting: Array<() => void> = [];
  const calls: string[][] = [];
  return {
    calls,
    callBatch: (batch: Batch) => {
      calls.push(batch.preferences.map((p) => p.id));
      return new Promise<Awaited<ReturnType<typeof noChanges>>>((resolve) =>
        waiting.push(() => resolve(noChanges(batch)))
      );
    },
    async release() {
      while (waiting.length === 0) await tick();
      waiting.shift()!();
      await tick();
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

async function settle(name: string, now?: number) {
  for (let i = 0; i < 200; i++) {
    const job = getAiCleanupJob(name, now);
    if (job && job.status.state !== "running") return job;
    await tick();
  }
  throw new Error("job did not finish");
}

it("returns at once, counts progress, and keeps the result for Apply", async () => {
  const name = user("progress");
  const model = gate();
  const job = startAiCleanupJob(
    name,
    { profileData, includeIds: ["pref_0", "pref_1", "pref_2", "pref_3"] },
    { callBatch: model.callBatch, batchSize: 2 }
  );
  expect(job.status).toEqual({ state: "running", done: 0, total: 2, failed: 0 });
  expect(job.selection).toEqual(["pref_0", "pref_1", "pref_2", "pref_3"]);
  await model.release();
  expect(getAiCleanupJob(name)!.status).toEqual({ state: "running", done: 1, total: 2, failed: 0 });
  await model.release();
  const done = await settle(name);
  expect(done.status.state).toBe("done");
  if (done.status.state !== "done") return;
  expect(done.status.result.failedBatches).toBe(0);
  expect(done.status.result.old).toBe(profileData);
  expect(getAiCleanupResult(name)?.old).toBe(profileData);
});

it("returns the running job to a second start and sends no extra request", async () => {
  const name = user("second-start");
  const model = gate();
  const first = startAiCleanupJob(name, { profileData, includeIds: ["pref_0"] }, model);
  const second = startAiCleanupJob(name, { profileData, includeIds: ["pref_1"] }, model);
  expect(second.id).toBe(first.id);
  await model.release();
  await settle(name);
  expect(model.calls).toEqual([["pref_0"]]);
});

it("counts failed batches while running", async () => {
  const name = user("failed-count");
  let call = 0;
  startAiCleanupJob(
    name,
    { profileData, includeIds: ["pref_0", "pref_1", "pref_2"] },
    {
      batchSize: 1,
      callBatch: (batch: Batch) =>
        ++call === 2 ? Promise.reject(new Error("x")) : noChanges(batch),
    }
  );
  const done = await settle(name);
  expect(done.status.state === "done" && done.status.result).toMatchObject({
    failedBatches: 1,
    failedItems: 1,
  });
});

it("stops: clears the job at once and sends no later batch", async () => {
  const name = user("stop");
  const model = gate();
  startAiCleanupJob(
    name,
    { profileData, includeIds: ["pref_0", "pref_1"] },
    {
      ...model,
      batchSize: 1,
    }
  );
  await tick();
  stopAiCleanupJob(name);
  expect(getAiCleanupJob(name)).toBeNull();
  await model.release();
  await tick();
  expect(model.calls).toEqual([["pref_0"]]);
  expect(getAiCleanupJob(name)).toBeNull();
  expect(getAiCleanupResult(name)).toBeNull();
});

it("a new start after Stop runs a fresh job", async () => {
  const name = user("restart");
  const model = gate();
  const first = startAiCleanupJob(name, { profileData, includeIds: ["pref_0"] }, model);
  stopAiCleanupJob(name);
  const second = startAiCleanupJob(name, { profileData, includeIds: ["pref_1"] }, model);
  expect(second.id).not.toBe(first.id);
  await model.release();
  await model.release();
  const done = await settle(name);
  expect(done.id).toBe(second.id);
});

it("forgets a finished job 30 minutes after it finished", async () => {
  const name = user("expiry");
  let now = 1_000_000;
  startAiCleanupJob(
    name,
    { profileData, includeIds: ["pref_0"] },
    {
      callBatch: noChanges,
      now: () => now,
    }
  );
  await settle(name, now);
  now += 29 * 60_000;
  expect(getAiCleanupJob(name, now)?.status.state).toBe("done");
  now += 2 * 60_000;
  expect(getAiCleanupJob(name, now)).toBeNull();
  expect(getAiCleanupResult(name, now)).toBeNull();
});

it("turns an empty selection into every item of the profile", async () => {
  const name = user("empty-selection");
  const job = startAiCleanupJob(name, { profileData, includeIds: [] }, { callBatch: noChanges });
  expect(job.selection).toEqual(["pref_0", "pref_1", "pref_2", "pref_3", "pref_4"]);
  await settle(name);
});

it("fails with a plain sentence when every batch times out", async () => {
  const name = user("timeout");
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
    name: "TimeoutError",
  });
  startAiCleanupJob(
    name,
    { profileData, includeIds: ["pref_0"] },
    {
      callBatch: () => Promise.reject(timeout),
    }
  );
  const done = await settle(name);
  expect(done.status).toEqual({ state: "failed", error: "The model did not answer in time." });
  expect(getAiCleanupResult(name)).toBeNull();
});

it("fails with the error text for other failures", async () => {
  const name = user("no-provider");
  startAiCleanupJob(
    name,
    { profileData, includeIds: ["pref_0"] },
    {
      callBatch: () => Promise.reject(new Error("No AI provider configured for profile cleanup")),
    }
  );
  const done = await settle(name);
  expect(done.status).toEqual({
    state: "failed",
    error: "No AI provider configured for profile cleanup",
  });
});

it("keeps jobs apart for each user", async () => {
  const a = user("user-a");
  const b = user("user-b");
  startAiCleanupJob(a, { profileData, includeIds: ["pref_0"] }, { callBatch: noChanges });
  expect(getAiCleanupJob(b)).toBeNull();
  await settle(a);
});
