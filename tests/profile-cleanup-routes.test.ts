import { expect, it, mock } from "bun:test";

const calls: Array<{ handler: string; userId: unknown }> = [];
mock.module("../src/services/auto-cleanup-handlers.js", () => ({
  handleAutoCleanupStatus: async (userId: unknown) => {
    calls.push({ handler: "status", userId });
    return { success: true, data: { id: 1, createdAt: 5, merged: 4, removed: 3 } };
  },
  handleAutoCleanupUndo: async (userId: unknown) => {
    calls.push({ handler: "undo", userId });
    return { success: true, data: { restored: 2, notFound: 1 } };
  },
}));
mock.module("../src/services/ai-cleanup-handlers.js", () => ({
  handleAiCleanupStart: async () => ({ success: true }),
  handleAiCleanupStatus: async () => ({ success: true }),
  handleAiCleanupStop: async (userId: unknown) => {
    calls.push({ handler: "ai-stop", userId });
    return { success: true };
  },
  handleAiCleanupApply: async () => ({ success: true }),
}));

const { getOrCreateAuthToken } = await import("../src/services/auth-token.js");
const { WebServer } = await import("../src/services/web-server.js");

const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });

async function call(method: string, path: string, body?: unknown, token = getOrCreateAuthToken()) {
  const response: Response = await (server as any).handleRequest(
    new Request(`http://127.0.0.1:4747${path}`, {
      method,
      headers: { "x-omms-token": token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  return response.json().catch(() => null);
}

it("routes the automatic cleanup status and undo to their handlers", async () => {
  calls.length = 0;
  expect(await call("GET", "/api/user-profile/auto-cleanup?userId=u1")).toEqual({
    success: true,
    data: { id: 1, createdAt: 5, merged: 4, removed: 3 },
  });
  expect(await call("POST", "/api/user-profile/auto-cleanup/undo", { userId: "u2" })).toEqual({
    success: true,
    data: { restored: 2, notFound: 1 },
  });
  await call("POST", "/api/user-profile/auto-cleanup/undo", {});
  expect(calls).toEqual([
    { handler: "status", userId: "u1" },
    { handler: "undo", userId: "u2" },
    { handler: "undo", userId: undefined },
  ]);
});

it("does not route the wrong method to a handler", async () => {
  calls.length = 0;
  await call("POST", "/api/user-profile/auto-cleanup", {});
  await call("GET", "/api/user-profile/auto-cleanup/undo");
  expect(calls).toEqual([]);
});

it("needs the token", async () => {
  calls.length = 0;
  const result = await call("GET", "/api/user-profile/auto-cleanup", undefined, "wrong");
  expect(result).toMatchObject({ success: false });
  expect(calls).toEqual([]);
});

it("passes the user in the query to the AI cleanup stop route", async () => {
  calls.length = 0;
  await call("DELETE", "/api/user-profile/ai-cleanup?userId=u3");
  await call("DELETE", "/api/user-profile/ai-cleanup");
  expect(calls).toEqual([
    { handler: "ai-stop", userId: "u3" },
    { handler: "ai-stop", userId: undefined },
  ]);
});
