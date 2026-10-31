import { expect, it, mock } from "bun:test";

const realHandlers = await import("../src/services/api-handlers.js");
const calls: Array<{ handler: string; userId: unknown; body?: unknown }> = [];
mock.module("../src/services/api-handlers.js", () => ({
  ...realHandlers,
  handleCategoryCleanupStart: async (userId: unknown) => {
    calls.push({ handler: "start", userId });
    return { success: true, data: { started: true } };
  },
  handleCategoryCleanupStatus: async (userId: unknown) => {
    calls.push({ handler: "status", userId });
    return { success: true, data: { state: "idle" } };
  },
  handleCategoryCleanupApply: async (userId: unknown, body: unknown) => {
    calls.push({ handler: "apply", userId, body });
    return { success: true, data: { applied: 2 } };
  },
  handleCategoryCleanupUndo: async (userId: unknown) => {
    calls.push({ handler: "undo", userId });
    return { success: true, data: { restored: 2 } };
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
  return response.json().catch(() => null);
}

it("routes the category cleanup start, status, apply and undo to their handlers", async () => {
  calls.length = 0;
  expect(await call("POST", "/api/user-profile/category-cleanup", { userId: "u1" })).toEqual({
    success: true,
    data: { started: true },
  });
  expect(await call("GET", "/api/user-profile/category-cleanup?userId=u2")).toEqual({
    success: true,
    data: { state: "idle" },
  });
  expect(
    await call("POST", "/api/user-profile/category-cleanup/apply", { userId: "u3", groups: [1] })
  ).toEqual({ success: true, data: { applied: 2 } });
  expect(await call("POST", "/api/user-profile/category-cleanup/undo", {})).toEqual({
    success: true,
    data: { restored: 2 },
  });
  expect(calls).toEqual([
    { handler: "start", userId: "u1" },
    { handler: "status", userId: "u2" },
    { handler: "apply", userId: "u3", body: { userId: "u3", groups: [1] } },
    { handler: "undo", userId: undefined },
  ]);
});

it("does not route the wrong method to a category cleanup handler", async () => {
  calls.length = 0;
  await call("DELETE", "/api/user-profile/category-cleanup");
  await call("GET", "/api/user-profile/category-cleanup/apply");
  expect(calls).toEqual([]);
});
