import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const { resolveCleanupModel } =
  await import("../src/services/user-profile/category-cleanup-model.js");
const { registerHostProfileModel } = await import("../src/services/user-profile/profile-model.js");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  registerHostProfileModel(null);
});

describe("resolveCleanupModel", () => {
  it("returns null when the settings name no external model", async () => {
    expect(await resolveCleanupModel({})).toBeNull();
  });

  it("uses the settings given on each call, not an earlier call's", async () => {
    const seen: Array<{ url: string; auth: string; model: unknown }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        auth: String((init.headers as Record<string, string>).Authorization),
        model: JSON.parse(String(init.body)).model,
      });
      return { ok: true, json: async () => ({ choices: [{ message: { content: "{}" } }] }) };
    }) as never;

    const first = await resolveCleanupModel({
      memoryModel: "m1",
      memoryApiUrl: "http://one.test",
      memoryApiKey: "k1",
    });
    const second = await resolveCleanupModel({
      memoryModel: "m2",
      memoryApiUrl: "http://two.test",
      memoryApiKey: "k2",
    });
    await first!("system", "user");
    await second!("system", "user");

    expect(seen).toEqual([
      { url: "http://one.test/chat/completions", auth: "Bearer k1", model: "m1" },
      { url: "http://two.test/chat/completions", auth: "Bearer k2", model: "m2" },
    ]);
  });
});
