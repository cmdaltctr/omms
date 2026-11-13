import { afterEach, expect, it } from "bun:test";
import { CONFIG } from "../src/config.js";
import { testExternalApi } from "../src/importer/external-api-test.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const provider = {
  data_collection: "deny",
  zdr: true,
  order: ["deepinfra"],
  only: ["deepinfra"],
  allow_fallbacks: false,
};

it("sends the saved memoryExtraParams.provider object in the Test call request body", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                { id: "1", function: { name: "acknowledge", arguments: '{"ok":true}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;

  const result = await testExternalApi({
    ...CONFIG,
    memoryProvider: "openai-chat",
    memoryModel: "deepseek/deepseek-chat",
    memoryApiUrl: "https://openrouter.ai/api/v1",
    memoryApiKey: "sk-test-key",
    memoryExtraParams: { thinking: { type: "adaptive" }, provider },
  });

  expect(result).toEqual({ ok: true, model: "openai-chat/deepseek/deepseek-chat" });
  expect(bodies).toHaveLength(1);
  expect(bodies[0]!.provider).toEqual(provider);
  // The other extra parameters travel with it.
  expect(bodies[0]!.thinking).toEqual({ type: "adaptive" });
});
