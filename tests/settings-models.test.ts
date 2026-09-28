import { describe, expect, it } from "bun:test";
import {
  listPiSettingsModels,
  listOpencodeSettingsModels,
} from "../src/importer/settings-models.js";

describe("settings model lists", () => {
  it("lists connected OpenCode provider models", async () => {
    const result = await listOpencodeSettingsModels({
      provider: {
        list: async () => ({
          data: {
            connected: ["zai"],
            all: [
              { id: "zai", models: { "glm-5.3": { name: "GLM 5.3" } } },
              { id: "other", models: { hidden: { name: "Hidden" } } },
            ],
          },
        }),
      },
    } as never);
    expect(result).toEqual({
      available: true,
      models: [{ provider: "zai", model: "glm-5.3", name: "GLM 5.3" }],
    });
  });
  it("uses the typed fallback when the Pi SDK cannot load", async () => {
    const result = await listPiSettingsModels(async () => {
      throw new Error("import failed");
    });
    expect(result).toMatchObject({ available: false });
    expect(JSON.stringify(result)).not.toContain("import failed");
  });
  it("refreshes Pi model availability without network access", async () => {
    let options: Record<string, unknown> | undefined;
    const result = await listPiSettingsModels(
      async () =>
        ({
          ModelRuntime: {
            create: async (input: Record<string, unknown>) => {
              options = input;
              return {
                getModels: () => [
                  { provider: "openai-codex", id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
                  { provider: "other", id: "hidden", name: "Hidden" },
                ],
                hasConfiguredAuth: (provider: string) =>
                  provider === "openai-codex" && input.refreshOnCreate !== false,
              };
            },
          },
        }) as never
    );
    expect(options).toMatchObject({ refreshOnCreate: true, allowModelNetwork: false });
    expect(result).toEqual({
      available: true,
      models: [{ provider: "openai-codex", model: "gpt-5.6-luna", name: "GPT 5.6 Luna" }],
    });
  });

  it("uses the typed fallback when the Pi runtime finds no signed-in models", async () => {
    const result = await listPiSettingsModels(
      async () =>
        ({
          ModelRuntime: {
            create: async () => ({ getModels: () => [], hasConfiguredAuth: () => false }),
          },
        }) as never
    );
    expect(result).toMatchObject({ available: false, models: [] });
  });
});
