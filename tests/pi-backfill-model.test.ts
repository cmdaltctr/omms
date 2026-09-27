import { expect, it } from "bun:test";
import { CONFIG } from "../src/config.js";
import { resolvePiBackfillModels } from "../src/adapters/pi/backfill-models.js";

it("resolves a named Pi backfill model without changing live capture", async () => {
  const calls: string[] = [];
  const ctx = {
    model: { provider: "zai", id: "session" },
    modelRegistry: {
      find: (provider: string, id: string) => ({ provider, id }),
      complete: async (model: { id: string }) => {
        calls.push(model.id);
        return { content: [{ type: "text", text: "done" }] };
      },
    },
  };
  const resolved = await resolvePiBackfillModels(ctx, { piBackfillModel: "zai/glm-5-turbo" });
  expect(resolved.model).toBe("zai/glm-5-turbo");
  await resolved.models.profile!.complete("system", "prompt");
  expect(calls).toEqual(["glm-5-turbo"]);
});

it("inherits the live Pi model rule", async () => {
  const previous = { piProvider: CONFIG.piProvider, piModel: CONFIG.piModel };
  CONFIG.piProvider = "zai";
  CONFIG.piModel = "configured";
  try {
    const ctx = {
      model: { provider: "zai", id: "session" },
      modelRegistry: {
        find: (provider: string, id: string) => ({ provider, id }),
        complete: async () => ({ content: [{ type: "text", text: "done" }] }),
      },
    };
    const resolved = await resolvePiBackfillModels(ctx, { piBackfillModel: "inherit" });
    expect(resolved.model).toBe("zai/configured");
  } finally {
    CONFIG.piProvider = previous.piProvider;
    CONFIG.piModel = previous.piModel;
  }
});
