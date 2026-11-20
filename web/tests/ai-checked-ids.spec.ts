import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";

// The hooks run at once outside a renderer; set calls with a value are recorded.
let sets: unknown[] = [];
const functionSets: unknown[] = [];
mock.module("react", () => ({
  ...react,
  useState: (initial: unknown) => [
    initial,
    (next: unknown) => (typeof next === "function" ? functionSets.push(next) : sets.push(next)),
  ],
  useEffect: (effect: () => void) => effect(),
  useCallback: (fn: unknown) => fn,
}));
const { aiCleanupApi } = await import("../src/lib/api.ts");
const { useAiCheckedIds } = await import("../src/hooks/useAiCheckedIds.ts");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let reply: unknown;
let reads = 0;

beforeEach(() => {
  sets = [];
  functionSets.length = 0;
  reads = 0;
  reply = { success: true, data: { profileVersion: 7, ids: ["pref_1", "pat_0"] } };
  aiCleanupApi.checked = (async () => {
    reads++;
    if (reply instanceof Error) throw reply;
    return reply;
  }) as typeof aiCleanupApi.checked;
});

it("gives the ids when the version matches the profile the dialog shows", async () => {
  useAiCheckedIds(true, 7);
  await settle();
  expect(sets).toEqual([new Set(["pref_1", "pat_0"])]);
});

it("gives an empty set when the version differs", async () => {
  useAiCheckedIds(true, 8);
  await settle();
  expect(sets).toEqual([new Set()]);
});

it("gives an empty set when the read fails, and does not throw", async () => {
  reply = { success: false, error: "down" };
  useAiCheckedIds(true, 7);
  await settle();
  expect(sets).toEqual([new Set()]);
  reply = new Error("network");
  useAiCheckedIds(true, 7);
  await settle();
  expect(sets).toEqual([new Set(), new Set()]);
});

it("reads nothing while the dialog is closed", async () => {
  useAiCheckedIds(false, 7);
  await settle();
  expect(reads).toBe(0);
});

it("reads again after Back and replaces the set", async () => {
  const first = useAiCheckedIds(true, 7);
  await settle();
  first.reload();
  expect(functionSets).toHaveLength(1);
  reply = { success: true, data: { profileVersion: 7, ids: ["wf_2"] } };
  useAiCheckedIds(true, 7);
  await settle();
  expect(sets).toEqual([new Set(["pref_1", "pat_0"]), new Set(["wf_2"])]);
});
