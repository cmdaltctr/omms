import { afterEach, expect, it } from "bun:test";
import { WebServer } from "../src/services/web-server.js";

// A web app that waits for the port retires when `web update` writes a marker
// later than the web app's start.

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function waiter(marker: () => number | null) {
  // The owner reports no version, so only the marker can retire the waiter.
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
  let reads = 0;
  const server = new WebServer({
    enabled: true,
    host: "127.0.0.1",
    port: 4747,
    readRetireMarker: () => {
      reads += 1;
      return marker();
    },
  });
  server.checkServerAvailable = async () => true;
  const tick = (server as unknown as { waiterTick(): Promise<void> }).waiterTick.bind(server);
  return { server, tick, reads: () => reads };
}

it("retires a standalone waiter that started before the marker", async () => {
  const { server, tick } = waiter(() => Date.now() + 60_000);
  let retired = 0;
  server.setOnStepAside(() => {
    retired += 1;
  });
  await tick();
  expect(retired).toBe(1);
});

it("keeps a waiter that started after the marker", async () => {
  const { server, tick } = waiter(() => Date.now() - 60_000);
  let retired = 0;
  server.setOnStepAside(() => {
    retired += 1;
  });
  await tick();
  expect(retired).toBe(0);
});

it("keeps a waiter when there is no marker", async () => {
  const { server, tick } = waiter(() => null);
  let retired = 0;
  server.setOnStepAside(() => {
    retired += 1;
  });
  await tick();
  expect(retired).toBe(0);
});

it("ignores the marker inside a host session, which sets no step-aside callback", async () => {
  const { server, tick, reads } = waiter(() => Date.now() + 60_000);
  await tick();
  expect(reads()).toBe(0);
  expect(server.isServerOwner()).toBe(false);
});
