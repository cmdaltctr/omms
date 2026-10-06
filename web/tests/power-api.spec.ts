import { afterEach, beforeEach, expect, it } from "bun:test";
import {
  readPowerStatus,
  sendPowerAction,
  sendUpdate,
  waitForUpdate,
  waitForWebApp,
} from "../src/lib/power.ts";

type Call = { url: string; init?: RequestInit };
const realFetch = globalThis.fetch;
let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  Object.assign(globalThis, { window: { __OMMS_TOKEN__: "page-token" } });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(reply: (call: Call) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return reply(call);
  }) as unknown as typeof fetch;
}

it("sends the token header with the POST that matches the choice", async () => {
  stubFetch(() => Response.json({ success: true }, { status: 202 }));
  expect(await sendPowerAction("restart")).toBe(true);
  expect(await sendPowerAction("stop")).toBe(true);
  expect(calls.map((call) => call.url)).toEqual(["/api/web/restart", "/api/web/stop"]);
  for (const call of calls) {
    expect(call.init?.method).toBe("POST");
    expect(new Headers(call.init?.headers).get("x-omms-token")).toBe("page-token");
  }
});

it("reports a refused or failed request as false", async () => {
  stubFetch(() => Response.json({ success: false }, { status: 403 }));
  expect(await sendPowerAction("stop")).toBe(false);
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  expect(await sendPowerAction("stop")).toBe(false);
});

it("reads the status with the token, and returns null on failure", async () => {
  stubFetch(() => Response.json({ version: "1.2.3", canControl: true }));
  expect(await readPowerStatus()).toEqual({ version: "1.2.3", canControl: true });
  expect(new Headers(calls[0]?.init?.headers).get("x-omms-token")).toBe("page-token");
  stubFetch(() => Response.json({ error: "Unauthorized" }, { status: 401 }));
  expect(await readPowerStatus()).toBeNull();
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  expect(await readPowerStatus()).toBeNull();
});

it("reads the instance value from the status", async () => {
  stubFetch(() => Response.json({ version: "1.2.3", canControl: true, instance: "abc" }));
  expect(await readPowerStatus()).toEqual({ version: "1.2.3", canControl: true, instance: "abc" });
});

/** Reply to status calls in order: an instance value, or null for no answer. */
function statusReplies(replies: (string | null)[]) {
  let index = 0;
  stubFetch(() => {
    const instance = replies[Math.min(index++, replies.length - 1)];
    if (instance === null) throw new TypeError("fetch failed");
    return Response.json({ version: "1.2.3", canControl: true, instance });
  });
  return () => index;
}

it("reports a restart once a new instance answers", async () => {
  // The old process answers, goes away, then the new copy answers.
  const count = statusReplies(["old", "old", null, null, "new"]);
  let slept = 0;
  const outcome = await waitForWebApp("old", { sleep: async (ms) => void (slept += ms) });
  expect(outcome).toBe("restarted");
  expect(count()).toBe(5);
  expect(calls.every((call) => call.url === "/api/web/status")).toBe(true);
  expect(slept).toBeGreaterThan(0);
});

it("reports unchanged when only the old instance answers for 30 seconds", async () => {
  statusReplies(["old"]);
  let slept = 0;
  expect(await waitForWebApp("old", { sleep: async (ms) => void (slept += ms) })).toBe("unchanged");
  expect(slept).toBeGreaterThanOrEqual(30_000);
});

it("reports down when nothing answers for 30 seconds", async () => {
  statusReplies([null]);
  let slept = 0;
  expect(await waitForWebApp("old", { sleep: async (ms) => void (slept += ms) })).toBe("down");
  expect(slept).toBeGreaterThanOrEqual(30_000);
});

it("reports the old instance that answers again after a gap as unchanged", async () => {
  // The copy failed and the old process serves again.
  statusReplies(["old", null, null, "old"]);
  expect(await waitForWebApp("old", { sleep: async () => undefined })).toBe("unchanged");
});

it("reads a valid update field and drops a malformed one", async () => {
  const update = { available: "4.10.0", state: "installing", code: null, canInstall: true };
  stubFetch(() => Response.json({ version: "4.9.0", canControl: true, update }));
  expect((await readPowerStatus())?.update).toEqual(update);
  stubFetch(() =>
    Response.json({ version: "4.9.0", canControl: true, update: { state: "rebooting" } })
  );
  expect((await readPowerStatus())?.update).toBeUndefined();
});

it("posts Update web app with the token", async () => {
  stubFetch(() => Response.json({ success: true }, { status: 202 }));
  expect(await sendUpdate()).toBe(true);
  expect(calls[0]?.url).toBe("/api/web/update");
  expect(calls[0]?.init?.method).toBe("POST");
  expect(new Headers(calls[0]?.init?.headers).get("x-omms-token")).toBe("page-token");
  stubFetch(() => Response.json({ success: false }, { status: 409 }));
  expect(await sendUpdate()).toBe(false);
});

it("waits through installing and an empty port until a new instance answers", async () => {
  const replies: (Response | null)[] = [
    Response.json({
      version: "4.9.0",
      canControl: true,
      instance: "old",
      update: { state: "installing", available: "4.10.0", code: null, canInstall: true },
    }),
    null,
    Response.json({ version: "4.10.0", canControl: true, instance: "new" }),
  ];
  globalThis.fetch = (async () => {
    const next = replies.shift();
    if (!next) throw new TypeError("fetch failed");
    return next;
  }) as unknown as typeof fetch;
  expect(await waitForUpdate("old", { sleep: async () => {} })).toEqual({ kind: "restarted" });
});

it("reports the failure code the old web app shows", async () => {
  stubFetch(() =>
    Response.json({
      version: "4.9.0",
      canControl: true,
      instance: "old",
      update: { state: "failed", available: "4.10.0", code: "network", canInstall: true },
    })
  );
  expect(await waitForUpdate("old", { sleep: async () => {} })).toEqual({
    kind: "failed",
    code: "network",
  });
});

it("gives up after the update wait", async () => {
  let slept = 0;
  stubFetch(() =>
    Response.json({
      version: "4.9.0",
      canControl: true,
      instance: "old",
      update: { state: "installing", available: "4.10.0", code: null, canInstall: true },
    })
  );
  const outcome = await waitForUpdate("old", { sleep: async (ms) => void (slept += ms) });
  expect(outcome).toEqual({ kind: "timeout" });
  expect(slept).toBeGreaterThanOrEqual(7 * 60_000);
});
