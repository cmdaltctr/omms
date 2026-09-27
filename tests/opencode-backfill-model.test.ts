import { expect, it } from "bun:test";
import { resolveOpencodeBackfillModels } from "../src/adapters/opencode/backfill-models.js";

const makeModels = async (ref: { providerID: string; modelID: string }) => ({
  capture: { summarize: async () => null },
  profile: { provider: ref.providerID, modelId: ref.modelID, complete: async () => "" },
});

it("resolves a connected named OpenCode model", async () => {
  const result = await resolveOpencodeBackfillModels(
    { opencodeBackfillModel: "zai/glm-5-turbo" },
    { connected: ["zai"], directory: "/project", configModel: async () => null, makeModels }
  );
  expect(result.model).toBe("zai/glm-5-turbo");
});

it("rejects a provider that is not signed in", async () => {
  await expect(
    resolveOpencodeBackfillModels(
      { opencodeBackfillModel: "zai/glm-5-turbo" },
      { connected: [], directory: "/project", configModel: async () => null, makeModels }
    )
  ).rejects.toThrow("not connected");
});

it("uses the configured OpenCode default in session mode", async () => {
  const result = await resolveOpencodeBackfillModels(
    { opencodeBackfillModel: "inherit" },
    {
      connected: ["zai"],
      directory: "/project",
      configModel: async () => "zai/default-model",
      makeModels,
    }
  );
  expect(result.model).toBe("zai/default-model");
});

it("inherits the external live model when it is configured", async () => {
  const result = await resolveOpencodeBackfillModels(
    {
      opencodeBackfillModel: "inherit",
      memoryModel: "small",
      memoryApiUrl: "https://example.invalid",
      memoryApiKey: "test-key",
    },
    {
      connected: [],
      directory: "/project",
      configModel: async () => null,
      makeModels,
      externalModels: () => ({
        provider: "openai-chat",
        modelId: "small",
        capture: { summarize: async () => null },
        profile: { provider: "openai-chat", modelId: "small", complete: async () => "" },
      }),
    }
  );
  expect(result.model).toBe("openai-chat/small");
});
