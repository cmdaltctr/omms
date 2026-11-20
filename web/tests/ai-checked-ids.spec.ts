import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";

// The hooks run at once outside a renderer. useState hands back queued values, and set calls
// with a value are recorded.
let sets: unknown[] = [];
const functionSets: unknown[] = [];
let queuedState: unknown[] = [];
mock.module("react", () => ({
  ...react,
  useState: (initial: unknown) => [
    queuedState.length ? queuedState.shift() : initial,
    (next: unknown) => (typeof next === "function" ? functionSets.push(next) : sets.push(next)),
  ],
  useEffect: (effect: () => void) => effect(),
  useCallback: (fn: unknown) => fn,
}));
const { aiCleanupApi } = await import("../src/lib/api.ts");
const { useAiCheckedIds } = await import("../src/hooks/useAiCheckedIds.ts");

type Answer = { snapshot: object; reads: number; ids: ReadonlySet<string> };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let reply: unknown;
let reads = 0;

beforeEach(() => {
  sets = [];
  functionSets.length = 0;
  queuedState = [];
  reads = 0;
  reply = { success: true, data: { profileVersion: 7, ids: ["pref_1", "pat_0"] } };
  aiCleanupApi.checked = (async () => {
    reads++;
    if (reply instanceof Error) throw reply;
    return reply;
  }) as typeof aiCleanupApi.checked;
});

/** Reads once for `snapshot`, then renders again with the answer it stored. */
async function answered(snapshot: { version?: number }) {
  const first = useAiCheckedIds(snapshot);
  await settle();
  const answer = sets.at(-1) as Answer;
  queuedState = [0, answer];
  return { first, answer, next: useAiCheckedIds(snapshot) };
}

it("is not ready, and shows no ids, while the read is pending", () => {
  const pending = useAiCheckedIds({ version: 7 });
  expect(pending.ready).toBe(false);
  expect(pending.ids.size).toBe(0);
});

it("gives the ids when the version matches the snapshot the dialog shows", async () => {
  const { answer, next } = await answered({ version: 7 });
  expect(answer.ids).toEqual(new Set(["pref_1", "pat_0"]));
  expect(next.ready).toBe(true);
  expect(next.ids).toEqual(new Set(["pref_1", "pat_0"]));
});

it("is ready with an empty set when the version differs", async () => {
  const { next } = await answered({ version: 8 });
  expect(next.ready).toBe(true);
  expect(next.ids.size).toBe(0);
});

it("is ready with an empty set when the read fails, and does not throw", async () => {
  reply = { success: false, error: "down" };
  expect((await answered({ version: 7 })).next).toMatchObject({ ready: true, ids: new Set() });
  reply = new Error("network");
  expect((await answered({ version: 7 })).next).toMatchObject({ ready: true, ids: new Set() });
});

it("does not use an answer for an earlier snapshot, for example after the dialog reopens", async () => {
  const { answer } = await answered({ version: 7 });
  queuedState = [0, answer];
  const reopened = useAiCheckedIds({ version: 7 });
  expect(reopened.ready).toBe(false);
  expect(reopened.ids.size).toBe(0);
});

it("reads nothing while there is no snapshot", async () => {
  useAiCheckedIds(null);
  await settle();
  expect(reads).toBe(0);
});

it("is not ready after Back until the new read answers", async () => {
  const snapshot = { version: 7 };
  const { next, answer } = await answered(snapshot);
  next.reload();
  expect(functionSets).toHaveLength(1);
  reply = { success: true, data: { profileVersion: 7, ids: ["wf_2"] } };
  queuedState = [1, answer];
  expect(useAiCheckedIds(snapshot).ready).toBe(false);
  await settle();
  expect((sets.at(-1) as Answer).ids).toEqual(new Set(["wf_2"]));
});
