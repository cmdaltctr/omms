import { expect, it } from "bun:test";
import { CONFIG } from "../src/config.js";
import { testExternalApi } from "../src/importer/external-api-test.js";

const config = {
  ...CONFIG,
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
