import { afterAll, beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";

let subscribe: ((listener: () => void) => () => void) | undefined;
mock.module("react", () => ({
  ...react,
  useSyncExternalStore: (sub: typeof subscribe, snapshot: () => unknown) => {
    subscribe = sub;
    return snapshot();
  },
}));

const originalFetch = globalThis.fetch;
const originalInterval = globalThis.setInterval;
const originalClear = globalThis.clearInterval;
const originalWindow = globalThis.window;
const requests: string[] = [];
const timers = new Map<number, { callback: () => void; ms: number }>();
let next = 0;
let reply: () => Response = () => new Response("{}");
Object.assign(globalThis, {
  window: {},
  document: { hidden: false },
  setInterval: (callback: () => void, ms: number) => {
    timers.set(++next, { callback, ms });
    return next;
  },
  clearInterval: (id: number) => timers.delete(id),
  fetch: async (path: string) => {
    requests.push(path);
    return reply();
  },
});
const { useWriteHealth } = await import("../src/lib/write-health-store.ts");
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const failing = () =>
  new Response(JSON.stringify({ ok: false, reason: "Embedding server error (500)", checkedAt: 1 }));

beforeEach(() => {
  requests.length = 0;
  timers.clear();
  reply = failing;
});

it("checks when the first view opens, again every five minutes, and stops with the last view", async () => {
  const hook = useWriteHealth();
  const stop = subscribe!(() => {});
  await settle();
  expect(requests).toEqual(["/api/memory/write-health"]);
  expect([...timers.values()].map((timer) => timer.ms)).toEqual([5 * 60_000]);
  // A second view on the same page shares the check.
  const stopSecond = subscribe!(() => {});
  expect(requests).toHaveLength(1);
  expect(timers.size).toBe(1);
  stop();
  expect(timers.size).toBe(1);
  stopSecond();
  expect(timers.size).toBe(0);
  expect(hook.health).toBeNull();
});

it("asks the server for a fresh result on Check again and keeps the last result when the app is unreachable", async () => {
  const stop = subscribe!(() => {});
  await settle();
  const { health, recheck } = useWriteHealth();
  expect(health).toEqual({ ok: false, reason: "Embedding server error (500)", checkedAt: 1 });
  await recheck();
  expect(requests.at(-1)).toBe("/api/memory/write-health?fresh=1");
  reply = () => {
    throw new Error("offline");
  };
  await recheck();
  expect(useWriteHealth().health?.reason).toBe("Embedding server error (500)");
  stop();
});

it("skips the timed check while the tab is hidden", async () => {
  const stop = subscribe!(() => {});
  await settle();
  const before = requests.length;
  (globalThis as { document: { hidden: boolean } }).document.hidden = true;
  [...timers.values()][0].callback();
  await settle();
  expect(requests).toHaveLength(before);
  (globalThis as { document: { hidden: boolean } }).document.hidden = false;
  [...timers.values()][0].callback();
  await settle();
  expect(requests).toHaveLength(before + 1);
  stop();
});

afterAll(() => {
  Object.assign(globalThis, {
    fetch: originalFetch,
    setInterval: originalInterval,
    clearInterval: originalClear,
    window: originalWindow,
  });
});
