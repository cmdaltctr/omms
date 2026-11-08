import { beforeEach, expect, it, mock } from "bun:test";

let status: { version: string; canControl: boolean; instance?: string } | null = null;
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 15_000,
  readPowerStatus: async () => status,
}));

const { refreshWebStatus } = await import("../src/lib/web-status.ts");

let reloads = 0;
beforeEach(() => {
  reloads = 0;
  Object.assign(globalThis, { window: { location: { reload: () => reloads++ } } });
});

/** Apply one status reply; `null` stands for a failed call. */
async function answer(next: { version: string; canControl: boolean; instance?: string } | null) {
  status = next;
  await refreshWebStatus();
}
const served = (instance: string) => ({ version: "5.8.0", canControl: true, instance });

// The store remembers the last applied instance for the whole file, so the tests
// form one timeline: each starts where the previous one ended.
it("does not reload on the first answer", async () => {
  await answer(served("first"));
  expect(reloads).toBe(0);
});

it("does not reload while the instance stays the same", async () => {
  await answer(served("first"));
  expect(reloads).toBe(0);
});

it("reloads once when a new instance answers, then not again for the same one", async () => {
  await answer(served("second"));
  expect(reloads).toBe(1);
  await answer(served("second"));
  expect(reloads).toBe(1);
});

it("does not reload on a failed call and still reloads for a later new instance", async () => {
  await answer(null);
  expect(reloads).toBe(0);
  await answer(served("third"));
  expect(reloads).toBe(1);
});
