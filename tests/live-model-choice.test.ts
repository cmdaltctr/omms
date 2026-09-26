import { afterEach, describe, expect, it, mock } from "bun:test";

const externalCalls: string[] = [];
mock.module("../src/importer/model-selection.js", () => ({
  selectImportModel: () => ({
    provider: "openai-chat",
    modelId: "external",
    capture: {
      summarize: async () => {
        externalCalls.push("capture");
        return { summary: "from external", type: "feature", tags: [] };
      },
    },
    profile: {
      provider: "openai-chat",
      modelId: "external",
      complete: async () => {
        externalCalls.push("profile");
        return "{}";
      },
    },
  }),
}));
mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const { CONFIG } = await import("../src/config.js");
const {
  getAutoCaptureProviderStatus,
  isExternalModelReady,
  resolveOpencodeHostModel,
  resolvePiLiveModel,
} = await import("../src/services/ai/live-model-choice.js");
const { createPiLiveModels } = await import("../src/adapters/pi/live-model.js");

const none = {
  opencodeProvider: undefined,
  opencodeModel: undefined,
  memoryProvider: "openai-chat",
  memoryModel: undefined,
  memoryApiUrl: undefined,
  memoryApiKey: undefined,
};
const external = {
  memoryModel: "cheap",
  memoryApiUrl: "https://api.example.invalid/v1",
  memoryApiKey: "real-key",
};

describe("one live-model rule for both hosts", () => {
  it("OpenCode: host model, else external API, else the session model", () => {
    const host = { ...none, opencodeProvider: "openai", opencodeModel: "gpt-5.6-luna" };
    expect(getAutoCaptureProviderStatus(host)).toMatchObject({ ready: true, mode: "opencode" });
    expect(resolveOpencodeHostModel(host)).toEqual({
      providerID: "openai",
      modelID: "gpt-5.6-luna",
    });
    expect(resolveOpencodeHostModel({ ...host, opencodeModel: "inherit" })?.modelID).toBe(
      "inherit"
    );

    expect(getAutoCaptureProviderStatus({ ...none, ...external })).toMatchObject({
      mode: "manual",
    });
    expect(resolveOpencodeHostModel({ ...none, ...external })).toBeNull();

    expect(getAutoCaptureProviderStatus(none)).toEqual({
      ready: true,
      mode: "session",
      issues: [],
    });
    expect(resolveOpencodeHostModel(none)).toEqual({ providerID: "", modelID: "inherit" });
  });

  it("reports a half-configured external API instead of silently switching", () => {
    const half = { ...none, memoryModel: "cheap" };
    expect(getAutoCaptureProviderStatus(half).ready).toBe(false);
    expect(resolveOpencodeHostModel(half)).toBeNull();
    expect(resolvePiLiveModel(half)).toMatchObject({ kind: "unready" });
    expect(isExternalModelReady(half)).toBe(false);
  });

  it("Pi: piProvider/piModel, else external API, else the session model", () => {
    const pinned = { ...none, piProvider: "openai-codex", piModel: "gpt-5.6-luna" };
    expect(resolvePiLiveModel(pinned)).toEqual({
      kind: "pi",
      provider: "openai-codex",
      model: "gpt-5.6-luna",
    });
    expect(resolvePiLiveModel({ ...pinned, piModel: "inherit" })).toEqual({ kind: "session" });
    expect(resolvePiLiveModel({ ...none, ...external })).toEqual({ kind: "manual" });
    expect(resolvePiLiveModel(none)).toEqual({ kind: "session" });
  });
});

describe("Pi live models", () => {
  const saved = {
    piProvider: CONFIG.piProvider,
    piModel: CONFIG.piModel,
    memoryModel: CONFIG.memoryModel,
    memoryApiUrl: CONFIG.memoryApiUrl,
    memoryApiKey: CONFIG.memoryApiKey,
  };
  afterEach(() => {
    Object.assign(CONFIG, saved);
    externalCalls.length = 0;
  });

  function ctx(reply: { fail?: boolean } = {}) {
    const called: string[] = [];
    const models: Record<string, { provider: string; id: string }> = {
      "openai-codex/gpt-5.6-luna": { provider: "openai-codex", id: "gpt-5.6-luna" },
    };
    return {
      called,
      ctx: {
        model: { provider: "zai", id: "session" },
        modelRegistry: {
          find: (provider: string, id: string) => models[`${provider}/${id}`],
          complete: async (model: { id: string }) => {
            called.push(model.id);
            if (reply.fail) return { content: [], stopReason: "error", errorMessage: "quota" };
            return { content: [{ type: "text", text: '{"type":"skip"}' }] };
          },
        },
      },
    };
  }
  const request = { userPrompt: "hi", context: "hi", sessionId: "s", projectDirectory: "/tmp" };

  it("uses the pinned Pi model, or the session model when nothing is set", async () => {
    Object.assign(CONFIG, { piProvider: "openai-codex", piModel: "gpt-5.6-luna" });
    Object.assign(CONFIG, { memoryModel: undefined, memoryApiUrl: undefined, memoryApiKey: "" });
    const pinned = ctx();
    await createPiLiveModels(pinned.ctx).capture.summarize(request);
    expect(pinned.called).toEqual(["gpt-5.6-luna"]);

    Object.assign(CONFIG, { piProvider: undefined, piModel: undefined });
    const session = ctx();
    await createPiLiveModels(session.ctx).capture.summarize(request);
    expect(session.called).toEqual(["session"]);
    expect(externalCalls).toEqual([]);
  });

  it("uses the external API when only it is configured", async () => {
    Object.assign(CONFIG, { piProvider: undefined, piModel: undefined, ...external });
    const live = ctx();
    const models = createPiLiveModels(live.ctx);
    expect((await models.capture.summarize(request))?.summary).toBe("from external");
    await models.profile()!.complete("system", "prompt");
    expect(live.called).toEqual([]);
    expect(externalCalls).toEqual(["capture", "profile"]);
  });

  it("falls back to the external API when the Pi model fails or is missing", async () => {
    Object.assign(CONFIG, { piProvider: "openai-codex", piModel: "gpt-5.6-luna", ...external });
    const failing = ctx({ fail: true });
    const notices: string[] = [];
    const summary = await createPiLiveModels(failing.ctx, (n) => {
      notices.push(n.title);
    }).capture.summarize(request);
    expect(failing.called).toEqual(["gpt-5.6-luna"]);
    expect(summary?.summary).toBe("from external");
    expect(notices).toEqual(["Using fallback provider"]);

    Object.assign(CONFIG, { piModel: "missing" });
    expect((await createPiLiveModels(ctx().ctx).capture.summarize(request))?.summary).toBe(
      "from external"
    );
  });

  it("surfaces the Pi failure when no external API is configured", async () => {
    Object.assign(CONFIG, { piProvider: "openai-codex", piModel: "missing" });
    Object.assign(CONFIG, { memoryModel: undefined, memoryApiUrl: undefined, memoryApiKey: "" });
    await expect(createPiLiveModels(ctx().ctx).capture.summarize(request)).rejects.toThrow(
      "Pi model openai-codex/missing was not found"
    );
    expect(externalCalls).toEqual([]);
  });
});
