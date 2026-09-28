import { afterEach, describe, expect, it } from "bun:test";
import { registerOpencodeHostModels } from "../src/importer/backfill-controls.js";
import type { StandaloneResult } from "../src/importer/opencode-standalone-models.js";
import {
  listPiSettingsModels,
  listOpencodeSettingsModels,
  OPENCODE_LIST_UNAVAILABLE,
  OPENCODE_NO_MODELS,
  OPENCODE_NOT_FOUND,
  OPENCODE_TOO_SLOW,
  OPENCODE_UNREADABLE,
  PI_LIST_UNAVAILABLE,
  PI_NO_MODELS,
} from "../src/importer/settings-models.js";

afterEach(() => registerOpencodeHostModels(null));

const standalone = (result: StandaloneResult) => {
  const calls: number[] = [];
  const read = async () => {
    calls.push(1);
    return result;
  };
  return { read, calls };
};

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
    expect(result).toEqual({ available: false, reason: PI_LIST_UNAVAILABLE });
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
    expect(result).toEqual({ available: false, models: [], reason: PI_NO_MODELS });
  });
});

describe("OpenCode model list without a session", () => {
  const zai = [{ provider: "zai-coding-plan", model: "glm-5.3", name: "GLM-5.3" }];

  it("lists the standalone models when no client or host is present", async () => {
    const { read, calls } = standalone({ outcome: "listed", models: zai });
    expect(await listOpencodeSettingsModels(undefined, read)).toEqual({
      available: true,
      models: zai,
    });
    expect(calls).toHaveLength(1);
  });

  it("returns the reason for each standalone outcome", async () => {
    const cases: Array<[StandaloneResult["outcome"], string]> = [
      ["not_found", OPENCODE_NOT_FOUND],
      ["start_timeout", OPENCODE_TOO_SLOW],
      ["empty", OPENCODE_NO_MODELS],
      ["unreadable", OPENCODE_UNREADABLE],
    ];
    for (const [outcome, reason] of cases) {
      const { read } = standalone({ outcome } as StandaloneResult);
      expect(await listOpencodeSettingsModels(undefined, read)).toEqual({
        available: false,
        reason,
      });
    }
  });

  it("does not start OpenCode when a client is passed", async () => {
    const { read, calls } = standalone({ outcome: "listed", models: zai });
    const client = { provider: { list: async () => ({ data: undefined }) } };
    expect(await listOpencodeSettingsModels(client as never, read)).toEqual({
      available: false,
      reason: OPENCODE_LIST_UNAVAILABLE,
    });
    expect(calls).toHaveLength(0);
  });

  it("does not start OpenCode when an OpenCode host is registered", async () => {
    const { read, calls } = standalone({ outcome: "listed", models: zai });
    registerOpencodeHostModels({
      isProviderConnected: () => true,
      createImportModels: async () => {
        throw new Error("unused");
      },
      listSettingsModels: async () => null,
    });
    expect(await listOpencodeSettingsModels(undefined, read)).toEqual({
      available: false,
      reason: OPENCODE_LIST_UNAVAILABLE,
    });
    expect(calls).toHaveLength(0);
  });

  it("skips the standalone read when the caller passes null", async () => {
    expect(await listOpencodeSettingsModels(undefined, null)).toEqual({
      available: false,
      reason: OPENCODE_LIST_UNAVAILABLE,
    });
  });

  it("returns the generic reason when the standalone read throws", async () => {
    const result = await listOpencodeSettingsModels(undefined, async () => {
      throw new Error("secret-detail");
    });
    expect(result).toEqual({ available: false, reason: OPENCODE_LIST_UNAVAILABLE });
  });
});
