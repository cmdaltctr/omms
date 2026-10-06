import { expect, it, mock } from "bun:test";

let reads = 0;
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 20,
  readPowerStatus: async () => {
    reads++;
    return { version: "1.0.0", canControl: true, instance: "a" };
  },
}));

const { subscribeWebStatus } = await import("../src/lib/web-status.ts");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it("sends one request per interval with two readers mounted", async () => {
  const seen: string[] = [];
  const stopA = subscribeWebStatus((s) => s.status && seen.push(`a:${s.status.version}`));
  const stopB = subscribeWebStatus((s) => s.status && seen.push(`b:${s.status.version}`));
  await wait(0);
  const afterMount = reads;
  await wait(70);
  const polled = reads - afterMount;
  // Three intervals pass in 70 ms; two timers would read about six times.
  expect(polled).toBeGreaterThanOrEqual(2);
  expect(polled).toBeLessThanOrEqual(4);
  expect(seen).toContain("a:1.0.0");
  expect(seen).toContain("b:1.0.0");
  stopA();
  stopB();
  const stopped = reads;
  await wait(50);
  expect(reads).toBe(stopped);
});
