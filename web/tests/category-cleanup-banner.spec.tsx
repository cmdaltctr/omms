import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import { bannerView, keepPolling, type CleanupJob } from "../src/lib/category-cleanup-status.ts";

// Hooks run outside a renderer: state lives in `states`, effects are collected and run by hand.
let states: unknown[] = [];
let cursor = 0;
let effects: Array<() => unknown> = [];
mock.module("react", () => ({
  ...react,
  useState: (initial: unknown) => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [
      states[index],
      (value: unknown) => {
        states[index] = typeof value === "function" ? value(states[index]) : value;
      },
    ];
  },
  useEffect: (effect: () => unknown) => effects.push(effect),
}));
let requests: Array<{ url: string; method: string }> = [];
let replies: Array<{ success: boolean; data?: unknown; error?: string }> = [];
mock.module("../src/lib/api.ts", () => ({
  fetchAPI: async (url: string, options: { method?: string } = {}) => {
    requests.push({ url, method: options.method ?? "GET" });
    return replies.shift() ?? { success: true, data: null };
  },
}));
const toasts = { error: mock(() => {}), warning: mock(() => {}), info: mock(() => {}) };
mock.module("sonner", () => ({ toast: toasts }));
const { useCategoryCleanupStatus } = await import("../src/hooks/useCategoryCleanupStatus.ts");

const preview = { before: 1257, after: 1189, groups: [{}, {}, {}] };
const job = (status: CleanupJob["status"]): CleanupJob => ({ id: "1", status });

it("shows no banner when no job exists", () => {
  expect(bannerView(null)).toBeNull();
});

it("maps each job state to what the banner shows", () => {
  expect(bannerView(job({ state: "grouping" }))).toEqual({ kind: "grouping" });
  expect(bannerView(job({ state: "checking", done: 3, total: 15 }))).toEqual({
    kind: "checking",
    done: 3,
    total: 15,
  });
  expect(bannerView(job({ state: "done", preview }))).toEqual({ kind: "ready", groups: 3 });
  expect(bannerView(job({ state: "failed", error: "Model timed out" }))).toEqual({
    kind: "failed",
    error: "Model timed out",
  });
});

it("shows a checking job with no batches as grouping, as the dialog does", () => {
  expect(bannerView(job({ state: "checking", done: 0, total: 0 }))).toEqual({ kind: "grouping" });
});

it("keeps polling only while the job is grouping or checking", () => {
  expect(keepPolling(job({ state: "grouping" }))).toBe(true);
  expect(keepPolling(job({ state: "checking", done: 1, total: 2 }))).toBe(true);
  expect(keepPolling(job({ state: "done", preview }))).toBe(false);
  expect(keepPolling(job({ state: "failed", error: "x" }))).toBe(false);
  expect(keepPolling(null)).toBe(false);
});

// Hook: the timer is replaced, so a test sees whether the next request is scheduled or cleared.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let scheduled: Array<{ run: () => void; ms: number }> = [];
let cleared = 0;
beforeEach(() => {
  states = [];
  effects = [];
  requests = [];
  replies = [];
  scheduled = [];
  cleared = 0;
  Object.values(toasts).forEach((fn) => fn.mockClear());
  globalThis.setTimeout = ((run: () => void, ms: number) => {
    scheduled.push({ run, ms });
    return scheduled.length;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {
    cleared++;
  }) as unknown as typeof clearTimeout;
});
afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
async function mount(paused: boolean) {
  cursor = 0;
  useCategoryCleanupStatus(paused);
  const clean = effects.splice(0).map((effect) => effect());
  await settle();
  return clean.find((value) => typeof value === "function") as (() => void) | undefined;
}
const checking = job({ state: "checking", done: 2, total: 9 });

it("asks once with GET only and stores the job it gets", async () => {
  replies = [{ success: true, data: job({ state: "done", preview }) }];
  await mount(false);
  expect(requests).toEqual([{ url: "/api/user-profile/category-cleanup", method: "GET" }]);
  expect(states[0]).toEqual(job({ state: "done", preview }));
  expect(scheduled).toHaveLength(0);
});

it("asks again after 3 seconds while the job is working, and not after it finishes", async () => {
  replies = [
    { success: true, data: checking },
    { success: true, data: job({ state: "done", preview }) },
  ];
  await mount(false);
  expect(scheduled.map((entry) => entry.ms)).toEqual([3000]);
  scheduled[0]!.run();
  await settle();
  expect(requests).toHaveLength(2);
  expect(requests.every((request) => request.method === "GET")).toBe(true);
  expect(states[0]).toEqual(job({ state: "done", preview }));
  expect(scheduled).toHaveLength(1);
});

it("stops on a failed job", async () => {
  replies = [{ success: true, data: job({ state: "failed", error: "Model timed out" }) }];
  await mount(false);
  expect(scheduled).toHaveLength(0);
});

it("sends nothing while paused", async () => {
  await mount(true);
  expect(requests).toHaveLength(0);
  expect(scheduled).toHaveLength(0);
});

it("shows nothing, schedules nothing and raises no toast when the request fails", async () => {
  replies = [{ success: false, error: "Unauthorized" }];
  await mount(false);
  expect(states[0]).toBeNull();
  expect(scheduled).toHaveLength(0);
  expect(toasts.error).not.toHaveBeenCalled();
  expect(toasts.warning).not.toHaveBeenCalled();
});

it("clears the timer and ignores a late reply after cleanup", async () => {
  replies = [{ success: true, data: checking }];
  const clean = await mount(false);
  expect(typeof clean).toBe("function");
  clean!();
  expect(cleared).toBeGreaterThan(0);
  replies = [{ success: true, data: job({ state: "done", preview }) }];
  scheduled[0]!.run();
  await settle();
  expect(states[0]).toEqual(checking);
  expect(scheduled).toHaveLength(1);
});
