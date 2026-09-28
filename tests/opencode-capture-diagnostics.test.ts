import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { CaptureAttemptDiagnostics } from "../src/core/host.js";

const config: Record<string, unknown> = {};
let structuredBehaviour: (opts: any) => Promise<unknown> = async () => ({});
let toolCallResult: Record<string, unknown> = { success: true, data: {} };

mock.module("../src/config.js", () => ({ CONFIG: config }));
mock.module("../src/services/logger.js", () => ({ log: () => {} }));
mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  loadOpencodeProvider: async () => ({
    isProviderConnected: () => true,
    getV2Client: () => ({}),
    resolveOpencodeModelRef: (ref: { providerID: string; modelID: string }) => ref,
    generateStructuredOutput: (opts: any) => structuredBehaviour(opts),
  }),
}));
mock.module("../src/services/ai/provider-config.js", () => ({
  buildMemoryProviderConfig: () => ({}),
}));
mock.module("../src/services/ai/ai-provider-factory.js", () => ({
  AIProviderFactory: {
    createProvider: () => ({ executeToolCall: async () => toolCallResult }),
  },
}));

const { generateOpenCodeAutoCaptureSummary } =
  await import("../src/adapters/opencode/auto-capture-summary.js");

function hostModelConfig() {
  for (const key of Object.keys(config)) delete config[key];
  Object.assign(config, {
    autoCaptureLanguage: "en",
    opencodeProvider: "anthropic",
    opencodeModel: "claude-haiku",
  });
}

function externalConfig() {
  for (const key of Object.keys(config)) delete config[key];
  Object.assign(config, {
    autoCaptureLanguage: "en",
    memoryProvider: "openai-chat",
    memoryModel: "glm-5.3",
    memoryApiUrl: "https://example.invalid/v1",
    memoryApiKey: "key",
  });
}

async function run(): Promise<{ error?: unknown; diagnostics: CaptureAttemptDiagnostics }> {
  const diagnostics: CaptureAttemptDiagnostics = {};
  try {
    await generateOpenCodeAutoCaptureSummary({
      context: "ctx",
      sessionId: "s",
      projectDirectory: "/p",
      userPrompt: "hi",
      diagnostics,
    });
    return { diagnostics };
  } catch (error) {
    return { error, diagnostics };
  }
}

describe("OpenCode capture diagnostics", () => {
  beforeEach(() => {
    structuredBehaviour = async () => ({});
    toolCallResult = { success: true, data: {} };
  });

  it("records the host model's finish reason and part types on success", async () => {
    hostModelConfig();
    structuredBehaviour = async (opts) => {
      const output = { summary: "Did it", type: "feature", tags: [] };
      opts.onReply({ finish: "stop", partTypes: ["reasoning", "text"], structuredOutput: output });
      return output;
    };
    const { error, diagnostics } = await run();
    expect(error).toBeUndefined();
    expect(diagnostics).toMatchObject({
      path: "host-model",
      provider: "anthropic",
      model: "claude-haiku",
      stopReason: "stop",
      blockTypes: ["reasoning", "text"],
    });
    expect(diagnostics.failureReason).toBeUndefined();
  });

  it("reports no structured output from the host model as empty-text", async () => {
    hostModelConfig();
    structuredBehaviour = async () => {
      throw new Error("omms: opencode returned no structured output (info.structured was empty)");
    };
    const { error, diagnostics } = await run();
    expect(error).toBeDefined();
    expect(diagnostics.failureReason).toBe("empty-text");
  });

  it("reports a host model schema failure as schema-mismatch", async () => {
    hostModelConfig();
    structuredBehaviour = async () => {
      const { z } = await import("zod");
      return z.object({ summary: z.string() }).parse({ summary: 1 });
    };
    const { error, diagnostics } = await run();
    expect(error).toBeDefined();
    expect(diagnostics.failureReason).toBe("schema-mismatch");
  });

  it("calls only the external API when opencodeModel is external", async () => {
    externalConfig();
    Object.assign(config, { opencodeProvider: "anthropic", opencodeModel: "external" });
    let hostCalls = 0;
    structuredBehaviour = async () => {
      hostCalls++;
      return {};
    };
    const { diagnostics } = await run();
    expect(hostCalls).toBe(0);
    expect(diagnostics).toMatchObject({ path: "external-api", model: "glm-5.3" });
  });

  it("reports a failed external API call as call-error", async () => {
    externalConfig();
    toolCallResult = {
      success: false,
      error: "API error: 500",
      stopReason: "stop",
      httpStatus: 500,
    };
    const { error, diagnostics } = await run();
    expect(error).toBeDefined();
    expect(diagnostics).toMatchObject({
      path: "external-api",
      provider: "openai-chat",
      model: "glm-5.3",
      failureReason: "call-error",
    });
  });

  it("reports an external API request with no reply as call-error", async () => {
    externalConfig();
    toolCallResult = { success: false, error: "TypeError: fetch failed", transportError: true };
    const { diagnostics } = await run();
    expect(diagnostics.failureReason).toBe("call-error");
  });

  it("reports an unusable external API reply with no HTTP error as schema-mismatch", async () => {
    externalConfig();
    toolCallResult = { success: false, error: "Max iterations (5) reached without tool call" };
    const { diagnostics } = await run();
    expect(diagnostics.failureReason).toBe("schema-mismatch");
  });

  it("reports an external API length stop as truncated", async () => {
    externalConfig();
    toolCallResult = { success: false, error: "Max iterations", stopReason: "length" };
    const { diagnostics } = await run();
    expect(diagnostics).toMatchObject({ stopReason: "length", failureReason: "truncated" });
  });

  it("reports an external API reply with the wrong shape as schema-mismatch", async () => {
    externalConfig();
    toolCallResult = { success: true, data: { type: "feature", summary: "" } };
    const { diagnostics } = await run();
    expect(diagnostics.failureReason).toBe("schema-mismatch");
    expect(diagnostics.rawReply).toBe('{"type":"feature","summary":""}');
  });
});
