import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const { callAICleanup } = await import("../src/services/user-profile/ai-cleanup.js");
const { registerHostProfileModel } = await import("../src/services/user-profile/profile-model.js");

const reply = JSON.stringify({
  preferences: [{ id: "pref_0", category: "c", description: "d" }],
  patterns: [],
  workflows: [],
  mapping: { kept: ["pref_0"], merged: [], removed: [] },
});

afterEach(() => registerHostProfileModel(null));

describe("callAICleanup with a given model", () => {
  it("uses the given model and not the registered host model", async () => {
    const calls: string[] = [];
    registerHostProfileModel(
      async () =>
        ({
          complete: async () => {
            calls.push("host");
            return reply;
          },
        }) as never
    );
    const given = {
      complete: async () => {
        calls.push("given");
        return reply;
      },
    };

    const result = await callAICleanup("prompt", {}, given as never);

    expect(calls).toEqual(["given"]);
    expect(result.mapping.kept).toEqual(["pref_0"]);
  });

  it("still uses the registered host model when no model is given", async () => {
    const calls: string[] = [];
    registerHostProfileModel(
      async () =>
        ({
          complete: async () => {
            calls.push("host");
            return reply;
          },
        }) as never
    );

    await callAICleanup("prompt", {});

    expect(calls).toEqual(["host"]);
  });
});

describe("callAICleanup external API settings", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("uses the settings given on each call, not an earlier call's", async () => {
    const seen: Array<{ url: string; auth: string; model: unknown }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        auth: String((init.headers as Record<string, string>).Authorization),
        model: JSON.parse(String(init.body)).model,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: reply } }] }),
      };
    }) as never;

    await callAICleanup("prompt", {
      memoryModel: "m1",
      memoryApiUrl: "http://one.test",
      memoryApiKey: "k1",
    });
    await callAICleanup("prompt", {
      memoryModel: "m2",
      memoryApiUrl: "http://two.test",
      memoryApiKey: "k2",
    });

    expect(seen).toEqual([
      { url: "http://one.test/chat/completions", auth: "Bearer k1", model: "m1" },
      { url: "http://two.test/chat/completions", auth: "Bearer k2", model: "m2" },
    ]);
  });

  it("throws when the settings name no external model", async () => {
    await expect(callAICleanup("prompt", {})).rejects.toThrow("No AI provider configured");
  });
});
