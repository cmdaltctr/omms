import { expect, it } from "bun:test";
import { testExternalApi } from "../src/importer/external-api-test.js";

const config = {
  memoryProvider: "openai-chat" as const,
  memoryModel: "glm-5-turbo",
  memoryApiUrl: "https://api.example.invalid/v1",
  memoryApiKey: "sk-rejected-private-key",
};

it("reports a rejected key with the key redacted and a small output limit", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const result = await testExternalApi(config, (_provider, providerConfig) => {
    seen.push(providerConfig);
    return {
      executeToolCall: async () => ({
        success: false,
        error: "401 invalid api key sk-rejected-private-key (Bearer sk-rejected-private-key)",
      }),
    };
  });
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain("sk-rejected-private-key");
  expect(JSON.stringify(result)).toContain("[redacted]");
  expect(seen[0]).toMatchObject({ maxTokens: 64, extraParams: { max_tokens: 64 } });
});

it("reports success for an accepted call", async () => {
  const result = await testExternalApi(config, () => ({
    executeToolCall: async () => ({ success: true }),
  }));
  expect(result).toEqual({ ok: true, model: "openai-chat/glm-5-turbo" });
});

/** A provider whose call fails with `error`, as the real providers word their failures. */
const failingWith = (error: string) => () => ({
  executeToolCall: async () => ({ success: false, error }),
});

it("names why a test failed, with the HTTP status, so the page can say it in plain words", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['API error: 401 - {"error":{"message":"bad key"}}', { reason: "refused", status: 401 }],
    ["API error: 403 - forbidden", { reason: "refused", status: 403 }],
    ["API error: 404 - no such model", { reason: "not-found", status: 404 }],
    ["API error: 429 - slow down", { reason: "rate-limited", status: 429 }],
    ["Gemini API error: 503 - overloaded", { reason: "provider", status: 503 }],
    ["API error: 400 - bad request", { reason: "failed", status: 400 }],
    ["TypeError: fetch failed", { reason: "unreachable" }],
    ["TypeError: ECONNREFUSED: Unable to connect.", { reason: "unreachable" }],
    ["API request timeout (20000ms)", { reason: "unreachable" }],
    ["Anthropic API request timeout (20000ms)", { reason: "unreachable" }],
    ["Invalid API response format", { reason: "failed" }],
  ];
  for (const [error, expected] of cases) {
    const result = await testExternalApi(config, failingWith(error));
    expect(result, error).toMatchObject({ ok: false, ...expected });
    if (!("status" in expected)) expect("status" in result, error).toBe(false);
  }
});

it("says the settings are incomplete when the address, model or key is missing", async () => {
  const result = await testExternalApi({ ...config, memoryModel: undefined }, failingWith("x"));
  expect(result).toMatchObject({ ok: false, reason: "not-configured" });
});
