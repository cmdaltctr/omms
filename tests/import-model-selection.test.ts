import { expect, it, mock } from "bun:test";
import { CONFIG } from "../src/config.js";

const calls: Array<{ provider: string; config: { model: string; apiKey: string } }> = [];
const results: Array<{ name: string; tool: unknown }> = [];
mock.module("../src/services/ai/ai-provider-factory.js", () => ({
  AIProviderFactory: {
    getSupportedProviders: () => ["openai-chat", "anthropic"],
    createProvider: (provider: string, config: { model: string; apiKey: string }) => {
      calls.push({ provider, config });
      return {
        executeToolCall: async (
          _system: string,
          _prompt: string,
          tool: { function: { name: string } }
        ) => {
          results.push({ name: tool.function.name, tool });
          return {
            success: true,
            data:
              tool.function.name === "save_memory"
                ? { type: "skip" }
                : { preferences: [], patterns: [], workflows: [] },
          };
        },
      };
    },
  },
}));
const { selectImportModel } = await import("../src/importer/model-selection.js");

it("overrides the import model for both steps without changing configuration or exposing its key", async () => {
  const previous = {
    memoryProvider: CONFIG.memoryProvider,
    memoryModel: CONFIG.memoryModel,
    memoryApiUrl: CONFIG.memoryApiUrl,
    memoryApiKey: CONFIG.memoryApiKey,
  };
  const secret = "secret-import-key-for-test";
  process.env.OMMS_TEST_IMPORT_KEY = secret;
  try {
    Object.assign(CONFIG, {
      memoryProvider: "openai-chat",
      memoryModel: "default",
      memoryApiUrl: "https://default.invalid",
      memoryApiKey: "default-secret",
    });
    const selected = selectImportModel({
      provider: "anthropic",
      model: "cheap",
      apiUrl: "https://import.invalid",
      apiKeyEnv: "OMMS_TEST_IMPORT_KEY",
    });
    expect(calls[0]).toMatchObject({
      provider: "anthropic",
      config: { model: "cheap", apiKey: secret },
    });
    expect(CONFIG.memoryModel).toBe("default");
    expect(CONFIG.memoryApiKey).toBe("default-secret");
    expect(
      await selected.capture.summarize({
        userPrompt: "hi",
        context: "hi",
        sessionId: "s",
        projectDirectory: "/tmp",
      })
    ).toMatchObject({ type: "skip" });
    expect(JSON.parse(await selected.profile.complete("system", "prompt"))).toMatchObject({
      preferences: [],
    });
    expect(results.map((result) => result.name)).toEqual(["save_memory", "update_user_profile"]);
    expect(
      JSON.stringify({ provider: selected.provider, modelId: selected.modelId })
    ).not.toContain(secret);
    expect(() => selectImportModel({ model: "" })).toThrow("Missing memoryModel");
    expect(calls).toHaveLength(1);
  } finally {
    Object.assign(CONFIG, previous);
    delete process.env.OMMS_TEST_IMPORT_KEY;
  }
});
