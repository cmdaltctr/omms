import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Only the embedding model is stubbed. Config, stores and both host paths are real.
const embeddingStub = {
  embedWithTimeout: async () => new Float32Array([0.25, 0.5, 0.75, 1]),
  warmup: async () => {},
  isWarmedUp: true,
};
mock.module("../src/services/embedding.js", () => ({
  embeddingService: embeddingStub,
  EmbeddingService: { getInstance: () => embeddingStub },
  applyEmbeddingTaskPrefix: (_model: string, text: string) => text,
  loadLocalTransformersBackend: async () => null,
}));

const { initConfig, refreshConfigIfChanged } = await import("../src/config.js");
const { memoryClient } = await import("../src/services/client.js");
const { getTags } = await import("../src/services/tags.js");
const { createStoredSpace, spaceFiles, switchStoredSpace } =
  await import("../src/services/spaces/registry-store.js");
const { default: ommsPiExtension } = await import("../src/adapters/pi/extension.js");
const { createV2MemoryBridge } = await import("../src/v2/memory-bridge.js");

const omms = join(homedir(), ".omms");
const files = spaceFiles(omms);
let project: string;

const noop = () => undefined;
const loose = (): any => new Proxy(noop, { get: () => loose(), apply: () => undefined });

/** A Pi turn: the real before_agent_start handler, with a fake Pi and a fake context. */
function piTurn() {
  const handlers: Record<string, (event: unknown, ctx: unknown) => Promise<any>> = {};
  const pi = new Proxy(
    {},
    {
      get: (_target, name) =>
        name === "on"
          ? (event: string, handler: (event: unknown, ctx: unknown) => Promise<any>) => {
              handlers[event] = handler;
            }
          : loose(),
    }
  );
  ommsPiExtension(pi as never);
  const ctx = {
    cwd: project,
    hasUI: false,
    ui: loose(),
    sessionManager: { getSessionId: () => "pi-session", getBranch: () => [] },
  };
  return async (prompt: string): Promise<string> => {
    const result = await handlers.before_agent_start!({ prompt, systemPrompt: "SYSTEM" }, ctx);
    return result?.systemPrompt ?? "";
  };
}

async function remember(text: string) {
  const added = await memoryClient.addMemory(text, getTags(project).project.tag, {
    sessionID: "seed",
  });
  expect(added.success ? "ok" : added.error).toBe("ok");
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "omms-space-hosts-"));
  mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
  writeFileSync(
    join(homedir(), ".config", "omms", "omms.jsonc"),
    JSON.stringify({ embeddingDimensions: 4, visibleRecall: false })
  );
  initConfig(project);
  // Seed one memory in each space, then leave Default active.
  await remember("alpha fact kept in the default space");
  const space = await createStoredSpace(files, "Experiments");
  await switchStoredSpace(files, space.id);
  refreshConfigIfChanged(project);
  await remember("beta fact kept in the experiments space");
  await switchStoredSpace(files, "default");
  refreshConfigIfChanged(project);
});
afterAll(async () => {
  // Windows keeps a database file locked until its handle is released (TDR-018).
  await cleanupTursoTestDirectory(files.spacesRoot);
  await cleanupTursoTestDirectory(project);
  rmSync(files.registryPath, { force: true });
});

describe("hosts follow a space switch on the next turn", () => {
  it("Pi: before_agent_start refreshes and searches the new space", async () => {
    const turn = piTurn();
    const first = await turn("what do we know");
    expect(first).toContain("alpha fact");
    expect(first).not.toContain("beta fact");

    // The switch happens outside this process. The next turn must notice it by itself.
    await switchStoredSpace(files, "experiments");
    const second = await turn("what do we know");
    expect(second).toContain("beta fact");
    expect(second).not.toContain("alpha fact");

    await switchStoredSpace(files, "default");
    expect(await turn("what do we know")).toContain("alpha fact");
  });

  it("OpenCode V2: the prompt hook's budget snapshot refreshes and retrieval searches the new space", async () => {
    const bridge = createV2MemoryBridge(project);
    // The adapter's prompt hook calls snapshotRequestBudget() first, then retrieve().
    const turn = async () => {
      const budget = bridge.snapshotRequestBudget();
      return (await bridge.retrieve("what do we know", "v2-session", budget)) ?? "";
    };
    expect(await turn()).toContain("alpha fact");

    await switchStoredSpace(files, "experiments");
    const second = await turn();
    expect(second).toContain("beta fact");
    expect(second).not.toContain("alpha fact");
    await switchStoredSpace(files, "default");
  });
});
