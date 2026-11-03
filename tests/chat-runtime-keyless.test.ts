import { afterEach, describe, expect, it } from "bun:test";
import { callTool } from "../src/services/chat/chat-runtime.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const TOOL = {
  type: "function",
  function: {
    name: "answer",
    description: "Answer",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
};

function stubModelServer() {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "answer", arguments: JSON.stringify({ text: "ok" }) },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  return seen;
}

describe("chat model call without a key", () => {
  it("calls a model server on this machine with no Authorization header and no key set", async () => {
    const seen = stubModelServer();
    const result: any = await callTool(
      {
        storagePath: "/unused",
        memoryProvider: "openai-chat",
        memoryModel: "qwen",
        memoryApiUrl: "http://127.0.0.1:9931/v1",
      },
      "system",
      "user",
      TOOL
    );
    expect(result.success).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toStartWith("http://127.0.0.1:9931/v1");
    expect(Object.keys(seen[0]!.headers).map((name) => name.toLowerCase())).not.toContain(
      "authorization"
    );
  });

  it("still refuses a remote server with no key, before any request is made", async () => {
    const seen = stubModelServer();
    await expect(
      callTool(
        {
          storagePath: "/unused",
          memoryProvider: "openai-chat",
          memoryModel: "m",
          memoryApiUrl: "https://api.example.com/v1",
        },
        "system",
        "user",
        TOOL
      )
    ).rejects.toThrow("missing memoryApiKey");
    expect(seen).toHaveLength(0);
  });
});
