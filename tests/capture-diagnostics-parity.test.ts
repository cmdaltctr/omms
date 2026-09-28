import { describe, expect, it, mock } from "bun:test";
import type { CaptureAttemptDiagnostics } from "../src/core/host.js";

const config: Record<string, unknown> = { autoCaptureLanguage: "en" };
const invalid = { type: "feature", summary: "" };

mock.module("../src/config.js", () => ({ CONFIG: config }));
mock.module("../src/services/logger.js", () => ({ log: () => {} }));
mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  loadOpencodeProvider: async () => ({
    isProviderConnected: () => true,
    getV2Client: () => ({}),
    resolveOpencodeModelRef: (ref: { providerID: string; modelID: string }) => ref,
    generateStructuredOutput: async (opts: any) => {
      opts.onReply({ finish: "stop", partTypes: ["text"], structuredOutput: invalid });
      const { z } = await import("zod");
      return z.object({ summary: z.string().min(1) }).parse(invalid);
    },
  }),
}));
mock.module("../src/services/ai/provider-config.js", () => ({
  buildMemoryProviderConfig: () => ({}),
}));
mock.module("../src/services/ai/ai-provider-factory.js", () => ({
  AIProviderFactory: {
    createProvider: () => ({
      executeToolCall: async () => ({ success: true, data: invalid, stopReason: "stop" }),
    }),
  },
}));

const { createPiCaptureProvider } = await import("../src/adapters/pi/provider.js");
const { generateOpenCodeAutoCaptureSummary } =
  await import("../src/adapters/opencode/auto-capture-summary.js");
const { buildCaptureAttemptRecord } = await import("../src/services/capture-diagnostics.js");

function setConfig(values: Record<string, unknown>) {
  for (const key of Object.keys(config)) delete config[key];
  Object.assign(config, { autoCaptureLanguage: "en" }, values);
}

const request = (diagnostics: CaptureAttemptDiagnostics) => ({
  context: "ctx",
  sessionId: "s",
  projectDirectory: "/p",
  userPrompt: "hi",
  diagnostics,
});

async function recordFor(
  host: "pi" | "opencode",
  run: (d: CaptureAttemptDiagnostics) => Promise<unknown>
) {
  const diagnostics: CaptureAttemptDiagnostics = {};
  await run(diagnostics).catch(() => {});
  return buildCaptureAttemptRecord(
    { host, sourceType: "live-capture", sessionId: "s" },
    diagnostics,
    "failed",
    1
  );
}

describe("capture diagnostics parity", () => {
  it("gives the same record fields on the Pi, OpenCode host-model, and external API paths", async () => {
    setConfig({});
    const pi = await recordFor("pi", (d) =>
      createPiCaptureProvider(() => ({
        provider: "zai",
        modelId: "glm-5.3",
        complete: async () => ({
          content: [{ type: "text", text: JSON.stringify(invalid) }],
          stopReason: "stop",
        }),
      })).summarize(request(d))
    );

    setConfig({ opencodeProvider: "anthropic", opencodeModel: "claude-haiku" });
    const hostModel = await recordFor("opencode", (d) =>
      generateOpenCodeAutoCaptureSummary(request(d))
    );

    setConfig({
      memoryProvider: "openai-chat",
      memoryModel: "glm-5.3",
      memoryApiUrl: "https://example.invalid/v1",
      memoryApiKey: "key",
    });
    const external = await recordFor("opencode", (d) =>
      generateOpenCodeAutoCaptureSummary(request(d))
    );

    const keys = Object.keys(pi).sort();
    expect(Object.keys(hostModel).sort()).toEqual(keys);
    expect(Object.keys(external).sort()).toEqual(keys);

    // Every path observes the core fields and classifies the same bad reply.
    for (const record of [pi, hostModel, external]) {
      expect(record.provider).not.toBeNull();
      expect(record.model).not.toBeNull();
      expect(record.stopReason).toBe("stop");
      expect(record.promptChars).toBeGreaterThan(0);
      expect(record.replyChars).toBeGreaterThan(0);
      expect(record.reason).toBe("schema-mismatch");
    }
    expect(pi.path).toBe("host-model");
    expect(hostModel.path).toBe("host-model");
    expect(external.path).toBe("external-api");
  });
});
