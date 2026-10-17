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

    const result = await callAICleanup("prompt", given as never);

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

    await callAICleanup("prompt");

    expect(calls).toEqual(["host"]);
  });
});
