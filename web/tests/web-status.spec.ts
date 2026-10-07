import { expect, it, mock } from "bun:test";

let reads = 0;
let readImpl: null | (() => Promise<unknown>) = null;
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 20,
  readPowerStatus: async () => {
    if (readImpl) return readImpl();
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

it("drops a reply that arrives after a newer one", async () => {
  const { refreshWebStatus } = await import("../src/lib/web-status.ts");
  const replies: ((value: unknown) => void)[] = [];
  readImpl = () => new Promise((resolve) => replies.push(resolve));
  const seen: string[] = [];
  const stop = subscribeWebStatus((s) => s.status && seen.push(s.status.version));
  const older = refreshWebStatus();
  const newer = refreshWebStatus();
  // The newer request answers first, then the older one.
  replies.at(-1)!({ version: "new", canControl: true });
  await newer;
  replies.at(-2)!({ version: "old", canControl: true });
  await older;
  expect(seen.at(-1)).toBe("new");
  stop();
  readImpl = null;
});
