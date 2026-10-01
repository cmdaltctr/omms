import { expect, it, mock } from "bun:test";
import { CONFIG } from "../src/config.js";

const calls: Array<{
  provider: string;
  config: { model: string; apiKey: string; iterationTimeout?: number };
}> = [];
const results: Array<{ name: string; tool: unknown }> = [];
let failure: Record<string, unknown> | null = null;
mock.module("../src/services/ai/ai-provider-factory.js", () => ({
  AIProviderFactory: {
    getSupportedProviders: () => ["openai-chat", "anthropic"],
    createProvider: (
      provider: string,
      config: { model: string; apiKey: string; iterationTimeout?: number }
    ) => {
      calls.push({ provider, config });
      return {
        executeToolCall: async (
          _system: string,
          _prompt: string,
          tool: { function: { name: string } }
        ) => {
          results.push({ name: tool.function.name, tool });
          if (failure) return failure;
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
    expect(() =>
      selectImportModel({ provider: "anthropic", apiKeyEnv: "OMMS_TEST_IMPORT_KEY" })
    ).toThrow("--api-url is required");
    // One provider for capture and one for profile learning, each with its own time limit.
    expect(calls).toHaveLength(2);
  } finally {
    Object.assign(CONFIG, previous);
    delete process.env.OMMS_TEST_IMPORT_KEY;
  }
});

it("labels an external API failure so only a request with no reply or an HTTP error is retried", async () => {
  const previous = { ...CONFIG };
  Object.assign(CONFIG, {
    memoryProvider: "openai-chat",
    memoryModel: "m",
    memoryApiUrl: "https://default.invalid",
    memoryApiKey: "key-for-test",
  });
  const summarize = async (result: Record<string, unknown>) => {
    failure = { success: false, error: "failed", ...result };
    const diagnostics: Record<string, unknown> = {};
    await selectImportModel({})
      .capture.summarize({
        userPrompt: "hi",
        context: "hi",
        sessionId: "s",
        projectDirectory: "/tmp",
        diagnostics,
      })
      .catch(() => {});
    return diagnostics.failureReason;
  };
  try {
    const diagnostics: Record<string, unknown> = {};
    await selectImportModel({}).capture.summarize({
      userPrompt: "hi",
      context: "hi",
      sessionId: "s",
      projectDirectory: "/tmp",
      diagnostics,
    });
    expect(diagnostics).toMatchObject({
      path: "external-api",
      provider: "openai-chat",
      model: "m",
    });
    failure = { success: false, error: "failed", httpStatus: 503 };
    const failed: Record<string, unknown> = {};
    await selectImportModel({})
      .capture.summarize({
        userPrompt: "hi",
        context: "hi",
        sessionId: "s",
        projectDirectory: "/tmp",
        diagnostics: failed,
      })
      .catch(() => {});
    expect(failed).toMatchObject({
      path: "external-api",
      provider: "openai-chat",
      model: "m",
      failureReason: "call-error",
    });
    expect(await summarize({ transportError: true })).toBe("call-error");
    expect(await summarize({ httpStatus: 503 })).toBe("call-error");
    expect(await summarize({})).toBe("schema-mismatch");
    expect(await summarize({ stopReason: "length" })).toBe("truncated");
  } finally {
    failure = null;
    Object.assign(CONFIG, previous);
  }
});

it("gives profile calls a 120-second limit and keeps the capture limit", () => {
  const previous = { ...CONFIG };
  Object.assign(CONFIG, {
    memoryProvider: "openai-chat",
    memoryModel: "m",
    memoryApiUrl: "https://default.invalid",
    memoryApiKey: "key-for-test",
    autoCaptureIterationTimeout: 30000,
  });
  try {
    calls.length = 0;
    selectImportModel({});
    expect(calls.map((call) => call.config.iterationTimeout)).toEqual([30000, 120000]);
  } finally {
    Object.assign(CONFIG, previous);
  }
});
