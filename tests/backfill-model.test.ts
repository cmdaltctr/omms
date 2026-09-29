import { describe, expect, it } from "bun:test";
import { parseBackfillModel } from "../src/importer/backfill-model.js";

describe("backfill model selection", () => {
  it("inherits the host live capture model", () => {
    expect(parseBackfillModel({ piBackfillModel: "inherit" }, "pi")).toBe("inherit");
  });

  it("splits only the first slash", () => {
    expect(parseBackfillModel({ piBackfillModel: "zai/glm-5-turbo" }, "pi")).toEqual({
      provider: "zai",
      model: "glm-5-turbo",
    });
    expect(parseBackfillModel({ opencodeBackfillModel: "a/b/c" }, "opencode")).toEqual({
      provider: "a",
      model: "b/c",
    });
  });

  it("rejects empty provider or model", () => {
    expect(() => parseBackfillModel({ piBackfillModel: "/model" }, "pi")).toThrow();
    expect(() => parseBackfillModel({ piBackfillModel: "provider/" }, "pi")).toThrow();
  });
});

describe("the external backfill model", () => {
  it("parses external as its own variant", () => {
    expect(parseBackfillModel({ opencodeBackfillModel: "external" }, "opencode")).toBe("external");
  });

  it("uses the external API only when it is configured", async () => {
    const { resolveExternalBackfillModels } =
      await import("../src/importer/external-backfill-models.js");
    const select = () => ({
      provider: "openai-chat",
      modelId: "glm",
      capture: { summarize: async () => null },
      profile: { provider: "openai-chat", modelId: "glm", complete: async () => "" },
    });
    const ready = { memoryModel: "glm", memoryApiUrl: "https://x.invalid", memoryApiKey: "k" };
    expect((await resolveExternalBackfillModels("pi", ready, select)).model).toBe(
      "openai-chat/glm"
    );
    await expect(
      resolveExternalBackfillModels("opencode", { ...ready, memoryApiUrl: undefined }, select)
    ).rejects.toThrow("OpenCode backfill: memoryApiUrl is not configured");
  });
});

describe("the Claude Code backfill model", () => {
  it("always uses the external API and reads no config key", () => {
    const read: PropertyKey[] = [];
    const config = new Proxy(
      { claudeBackfillModel: "x/y", opencodeBackfillModel: "a/b", piBackfillModel: "c/d" },
      {
        get(target, key, receiver) {
          read.push(key);
          return Reflect.get(target, key, receiver);
        },
      }
    );
    expect(parseBackfillModel(config, "claude-code")).toBe("external");
    expect(read).toEqual([]);
  });

  it("names the missing setting in the same words as Pi", async () => {
    const { resolveExternalBackfillModels } =
      await import("../src/importer/external-backfill-models.js");
    const unconfigured = { memoryApiUrl: "https://example.invalid/v1", memoryApiKey: "key" };
    const reason = async (host: "pi" | "claude-code") =>
      resolveExternalBackfillModels(host, unconfigured).then(
        () => "resolved",
        (error: Error) => error.message
      );
    const pi = await reason("pi");
    expect(pi).toBe("Pi backfill: memoryModel is not configured");
    expect(await reason("claude-code")).toBe(pi.replace(/^Pi /, "Claude Code "));
  });
});
