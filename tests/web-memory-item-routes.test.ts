import { beforeEach, describe, expect, it, mock } from "bun:test";

// The item routes under /api/memories/ and /api/prompts/ take exactly one ID
// segment. A longer path, such as DELETE on the pin route, must not reach the
// delete or update handler with the parent ID.

const real = await import("../src/services/api-handlers.js");
const calls: Array<{ handler: string; id: string }> = [];
const record =
  (handler: string) =>
  async (id: string): Promise<{ success: true }> => {
    calls.push({ handler, id });
    return { success: true };
  };
mock.module("../src/services/api-handlers.js", () => ({
  ...real,
  handleDeleteMemory: record("deleteMemory"),
  handleUpdateMemory: record("updateMemory"),
  handleDeletePrompt: record("deletePrompt"),
  handlePinMemory: record("pinMemory"),
}));
const { routeMemoryApi } = await import("../src/services/web-server/memory-api.js");

async function route(method: string, path: string) {
  const url = new URL(`http://127.0.0.1:4747${path}`);
  const body = method === "PUT" ? JSON.stringify({ content: "edited" }) : undefined;
  const req = new Request(url, { method, body, headers: { "content-type": "application/json" } });
  return routeMemoryApi({} as never, req, url);
}

beforeEach(() => {
  calls.length = 0;
});

describe("memory and prompt item routes", () => {
  it("passes the one ID of an item path to its handler", async () => {
    await route("DELETE", "/api/memories/mem_1");
    await route("PUT", "/api/memories/mem_2");
    await route("DELETE", "/api/prompts/prompt_3");
    await route("POST", "/api/memories/mem_4/pin");
    expect(calls).toEqual([
      { handler: "deleteMemory", id: "mem_1" },
      { handler: "updateMemory", id: "mem_2" },
      { handler: "deletePrompt", id: "prompt_3" },
      { handler: "pinMemory", id: "mem_4" },
    ]);
  });

  it("does not delete or update anything for a path with more than one ID segment", async () => {
    const responses = [
      await route("DELETE", "/api/memories/mem_1/pin"),
      await route("DELETE", "/api/memories/mem_1/extra/"),
      await route("PUT", "/api/memories/mem_1/mem_2"),
      await route("DELETE", "/api/prompts/prompt_3/memory"),
    ];
    expect(calls).toEqual([]);
    expect(responses).toEqual([null, null, null, null]);
  });

  it("keeps refusing the bulk-delete path as an item ID", async () => {
    const response = await route("DELETE", "/api/memories/bulk-delete");
    expect(calls).toEqual([]);
    expect(await response?.json()).toEqual({ success: false, error: "Invalid ID" });
  });
});
