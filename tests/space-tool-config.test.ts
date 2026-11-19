import { describe, expect, it, mock } from "bun:test";

// Capture what the preview action receives, so the test sees the settings snapshot.
const seen: { embedding: { model: string; dimensions: number }; maxVectorsPerShard: number }[] = [];
mock.module("../src/services/spaces/transfer-service.js", () => ({
  previewSpaceTransfer: async (_request: unknown, transfer: (typeof seen)[number]) => {
    seen.push(transfer);
    return { ok: true, preview: {} };
  },
  applySpaceTransfer: async () => ({ ok: false, error: "unused" }),
}));

const { runSpaceMode } = await import("../src/core/space-tool.js");

type FakeConfig = Parameters<typeof runSpaceMode>[0];

function activeSpace(id: string) {
  return { id, name: id, customStoragePath: false };
}

/** A stand-in for the config module. `refreshConfigIfChanged` replaces CONFIG like a real switch. */
function fakeModule(afterRefresh: () => void): FakeConfig {
  const module = {
    CONFIG: {
      storagePath: "/store/a",
      embeddingModel: "model-a",
      embeddingDimensions: 4,
      maxVectorsPerShard: 100,
    },
    active: activeSpace("a"),
    getActiveSpace: () => module.active,
    refreshConfigIfChanged: () => afterRefresh(),
  };
  return module as unknown as FakeConfig;
}

describe("runSpaceMode reads the live config module", () => {
  it("reports the active space and the refreshed settings after a switch", async () => {
    const config = fakeModule(() => {
      const module = config as unknown as {
        CONFIG: Record<string, unknown>;
        active: ReturnType<typeof activeSpace>;
      };
      module.active = activeSpace("b");
      // A real refresh assigns a new CONFIG object; the tool must not hold the old one.
      module.CONFIG = {
        storagePath: "/store/b",
        embeddingModel: "model-b",
        embeddingDimensions: 8,
        maxVectorsPerShard: 200,
      };
    });
    const preview = { spaceAction: "preview", spaceName: "x", spaceTo: "y" };

    const first = await runSpaceMode(config, { mode: "space", spaceAction: "status" }, "/p");
    expect(first).toMatchObject({ activeSpace: { id: "a" } });
    // The refresh after the first call switched to "b"; the second call must see it.
    const second = await runSpaceMode(config, { mode: "space", spaceAction: "status" }, "/p");
    expect(second).toMatchObject({ activeSpace: { id: "b" } });

    await runSpaceMode(config, { mode: "space", ...preview }, "/p");
    expect(seen.at(-1)).toMatchObject({
      embedding: { model: "model-b", dimensions: 8 },
      maxVectorsPerShard: 200,
    });
  });
});
