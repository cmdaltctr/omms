import { expect, it, mock } from "bun:test";

const calls: Array<{ handler: string; userId: unknown; body?: unknown }> = [];
mock.module("../src/services/ai-cleanup-handlers.js", () => ({
  handleAiCleanupStart: async (userId: unknown, body: unknown) => {
    calls.push({ handler: "start", userId, body });
    return { success: true, data: "started" };
  },
  handleAiCleanupStatus: async (userId: unknown) => {
    calls.push({ handler: "status", userId });
    return { success: true, data: "status" };
  },
  handleAiCleanupStop: async (userId: unknown) => {
    calls.push({ handler: "stop", userId });
    return { success: true, data: null };
  },
  handleAiCleanupApply: async (userId: unknown, body: unknown) => {
    calls.push({ handler: "apply", userId, body });
    return { success: true, data: "applied" };
  },
}));

const { getOrCreateAuthToken } = await import("../src/services/auth-token.js");
const { WebServer } = await import("../src/services/web-server.js");

const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });

async function call(method: string, path: string, body?: unknown) {
  const response: Response = await (server as any).handleRequest(
    new Request(`http://127.0.0.1:4747${path}`, {
      method,
      headers: { "x-omms-token": getOrCreateAuthToken(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  return response.json();
}

it("routes start, status, stop and apply to the AI cleanup handlers", async () => {
  calls.length = 0;
  expect(await call("POST", "/api/user-profile/ai-cleanup", { includeIds: ["pref_0"] })).toEqual({
    success: true,
    data: "started",
  });
  expect(await call("GET", "/api/user-profile/ai-cleanup?userId=u1")).toEqual({
    success: true,
    data: "status",
  });
  expect(await call("DELETE", "/api/user-profile/ai-cleanup")).toEqual({
    success: true,
    data: null,
  });
  expect(
    await call("POST", "/api/user-profile/ai-cleanup/apply", { acceptedRemoved: ["pref_2"] })
  ).toEqual({ success: true, data: "applied" });

  expect(calls).toEqual([
    { handler: "start", userId: undefined, body: { includeIds: ["pref_0"] } },
    { handler: "status", userId: "u1" },
    { handler: "stop", userId: undefined },
    { handler: "apply", userId: undefined, body: { acceptedRemoved: ["pref_2"] } },
  ]);
});
