import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { z } from "zod";

// The OpenCode model of a learning pass (change unify-profile-learning, task 6.1): one
// OpenCode structured-output call with the 120 s limit, and the external API with the shared
// fallback notice when that call fails. The config is the real CONFIG with fields set per test.

const world = {
  structured: [] as Array<{ providerID: string; modelID: string; userPrompt: string }>,
  structuredResult: (): Promise<unknown> => Promise.resolve({ ok: true }),
  external: [] as string[],
};

mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  loadOpencodeProvider: async () => ({
    generateStructuredOutput: (request: {
      providerID: string;
      modelID: string;
      userPrompt: string;
    }) => {
      world.structured.push({
        providerID: request.providerID,
        modelID: request.modelID,
        userPrompt: request.userPrompt,
      });
      return world.structuredResult();
    },
  }),
}));
mock.module("../src/adapters/opencode/profile-llm-client.js", () => ({
  getOpencodeProfileHost: async () => ({}),
}));
mock.module("../src/importer/model-selection.js", () => ({
  selectImportModel: () => ({
    profile: {
      provider: "external",
      modelId: "external-model",
      complete: async (_system: string, prompt: string) => {
        world.external.push(prompt);
        return JSON.stringify({ ok: true, from: "external" });
      },
    },
  }),
}));

const { CONFIG } = await import("../src/config.js");
const { createOpencodeLearningModel, OPENCODE_PROFILE_LEARNING_TIMEOUT_MS } =
  await import("../src/adapters/opencode/profile-model.js");

const schema = z.object({ ok: z.boolean() });
const realSetTimeout = globalThis.setTimeout;
let delays: number[] = [];

beforeEach(() => {
  world.structured = [];
  world.structuredResult = () => Promise.resolve({ ok: true });
  world.external = [];
  delays = [];
  Object.assign(CONFIG, {
    opencodeProvider: "opencode-go",
    opencodeModel: "test-model",
    memoryProvider: "openai-chat",
    memoryModel: undefined,
    memoryApiUrl: undefined,
    memoryApiKey: undefined,
  });
});

afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
});

/** Record each timer delay; fire the 120 s timer at once when `fireLimit` is set. */
function watchTimers(fireLimit = false) {
  globalThis.setTimeout = ((callback: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    return realSetTimeout(
      callback,
      fireLimit && ms === OPENCODE_PROFILE_LEARNING_TIMEOUT_MS ? 0 : ms
    );
  }) as typeof setTimeout;
}

const useExternal = () =>
  Object.assign(CONFIG, {
    memoryModel: "external-model",
    memoryApiUrl: "https://api.example.invalid/v1",
    memoryApiKey: "sk-test-key-123456",
  });

describe("the OpenCode learning model", () => {
  it("makes one OpenCode structured-output call with the 120 s limit", async () => {
    watchTimers();
    const model = createOpencodeLearningModel()!;
    expect(model.provider).toBe("opencode-go");
    expect(model.modelId).toBe("test-model");

    const reply = await model.completeStructured!("system", "the prompts", schema);

    expect(reply).toEqual({ ok: true });
    expect(world.structured).toEqual([
      { providerID: "opencode-go", modelID: "test-model", userPrompt: "the prompts" },
    ]);
    expect(OPENCODE_PROFILE_LEARNING_TIMEOUT_MS).toBe(120_000);
    expect(delays).toContain(120_000);
  });

  it("fails with a timeout when OpenCode does not answer within the limit", async () => {
    watchTimers(true);
    world.structuredResult = () => new Promise(() => {});
    const model = createOpencodeLearningModel()!;

    await expect(model.completeStructured!("system", "the prompts", schema)).rejects.toThrow(
      /timeout/
    );
    expect(world.structured).toHaveLength(1);
  });

  it("uses the external API and shows the fallback notice when OpenCode fails", async () => {
    useExternal();
    world.structuredResult = () => Promise.reject(new Error("provider overloaded"));
    const notices: unknown[] = [];
    const model = createOpencodeLearningModel((notice) => {
      notices.push(notice);
    })!;

    const reply = await model.completeStructured!("system", "the prompts", schema);

    expect(world.structured).toHaveLength(1);
    expect(world.external).toEqual(["the prompts"]);
    expect(reply).toEqual({ ok: true, from: "external" });
    expect(notices).toEqual([
      {
        title: "Using fallback provider",
        message: "OpenCode model failed (provider overloaded); using configured fallback.",
        variant: "warning",
      },
    ]);
  });

  it("rethrows the OpenCode error when the external API is not configured", async () => {
    world.structuredResult = () => Promise.reject(new Error("provider overloaded"));
    const notices: unknown[] = [];
    const model = createOpencodeLearningModel((notice) => {
      notices.push(notice);
    })!;

    await expect(model.completeStructured!("system", "the prompts", schema)).rejects.toThrow(
      "provider overloaded"
    );
    expect(world.external).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("is the external API when no OpenCode model is chosen", async () => {
    useExternal();
    Object.assign(CONFIG, { opencodeProvider: undefined, opencodeModel: undefined });
    const model = createOpencodeLearningModel()!;

    expect(model.completeStructured).toBeUndefined();
    expect(await model.complete("system", "the prompts")).toContain('"external"');
    expect(world.structured).toEqual([]);
  });
});
