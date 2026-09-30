import { afterEach, beforeEach, expect, it } from "bun:test";
import { readPowerStatus, sendPowerAction, waitForWebApp } from "../src/lib/power.ts";

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

it("waits for the old web app to go away, then for the new one to answer", async () => {
  // Answers, answers, refuses, refuses, then the new copy answers.
  const answers = [true, true, false, false, true];
  let index = 0;
  stubFetch(() => {
    const up = answers[Math.min(index++, answers.length - 1)];
    if (!up) throw new TypeError("fetch failed");
    return Response.json({ success: true, status: "ok" });
  });
  let slept = 0;
  const up = await waitForWebApp({ sleep: async (ms) => void (slept += ms) });
  expect(up).toBe(true);
  expect(index).toBe(5);
  expect(slept).toBeGreaterThan(0);
});

it("gives up when the web app never comes back", async () => {
  stubFetch(() => {
    throw new TypeError("fetch failed");
  });
  let slept = 0;
  expect(await waitForWebApp({ sleep: async (ms) => void (slept += ms) })).toBe(false);
  expect(slept).toBeGreaterThanOrEqual(20_000);
});
