import { afterEach, describe, expect, it } from "bun:test";
import { createServer } from "node:net";
import { packageVersion } from "../src/services/package-version.js";
import { WebServer } from "../src/services/web-server.js";

// Pins two port-ownership paths that other tests reach only through child
// processes: a busy port makes the web server a waiter, and a standalone
// waiter retires when the owner runs a newer version.

const originalFetch = globalThis.fetch;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

type Internals = { healthCheckInterval: NodeJS.Timeout | null; waiterTick(): Promise<void> };

describe("port ownership", () => {
  it("waits for the port instead of failing when another process holds it", async () => {
    const port = await freePort();
    const holder = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("busy") });
    cleanups.push(() => holder.stop(true));
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port });
    cleanups.push(() => server.stop());

    await server.start();

    expect(server.isServerOwner()).toBe(false);
    expect(server.isRunning()).toBe(false);
    expect((server as unknown as Internals).healthCheckInterval).not.toBeNull();
    await server.stop();
    expect((server as unknown as Internals).healthCheckInterval).toBeNull();
  });
});

describe("takeover failure count", () => {
  it("clears the count when the owner answers the first health check", async () => {
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
    cleanups.push(() => server.stop());
    const internals = server as unknown as Internals & {
      takeoverFailures: number;
      attemptTakeover(): Promise<void>;
      _start(): Promise<void>;
    };
    // Two takeovers failed while the owner was slow, then the owner answered again.
    internals.takeoverFailures = 2;
    server.checkServerAvailable = async () => true;
    await internals.waiterTick.call(server);

    // A later, unrelated failed takeover must count from zero, not move to the next port.
    server.checkServerAvailable = async () => false;
    internals._start = async () => {
      throw new Error("EADDRINUSE");
    };
    await internals.attemptTakeover.call(server);
    expect(server.getUrl()).toBe("http://127.0.0.1:4747");
    expect(internals.takeoverFailures).toBe(1);
  });
});

describe("waiter retirement", () => {
  function waiter(ownerVersion: string) {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(new URL(String(input)).pathname);
      return Response.json({ version: ownerVersion });
    }) as unknown as typeof fetch;
    const server = new WebServer({
      enabled: true,
      host: "127.0.0.1",
      port: 4747,
      readRetireMarker: () => null,
    });
    server.checkServerAvailable = async () => true;
    let retired = 0;
    server.setOnStepAside(() => {
      retired += 1;
    });
    const tick = (server as unknown as Internals).waiterTick.bind(server);
    return { tick, asked, retired: () => retired };
  }

  it("retires a standalone waiter when the owner is newer", async () => {
    const { tick, asked, retired } = waiter("999.0.0");
    await tick();
    expect(asked).toEqual(["/api/web/status"]);
    expect(retired()).toBe(1);
  });

  it("keeps a standalone waiter when the owner runs the same version", async () => {
    const { tick, retired } = waiter(packageVersion());
    await tick();
    expect(retired()).toBe(0);
  });
});
