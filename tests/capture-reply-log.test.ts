import { describe, expect, it, mock } from "bun:test";

const logged: Array<Record<string, unknown>> = [];
const secret = "test-api-key-never-log";
mock.module("../src/config.js", () => ({
  CONFIG: {
    autoCaptureLanguage: "en",
    memoryApiKey: secret,
    memoryProvider: "openai-chat",
    memoryModel: "example",
    memoryApiUrl: "https://example.invalid/v1",
  },
}));
mock.module("../src/services/logger.js", () => ({
  log: (_message: string, details: Record<string, unknown>) => logged.push(details),
}));

// The attempt record is also saved to the store in the background. With no
// store configured that save fails and logs later, sometimes during the next
// test, so stub it: these tests cover only what reaches the log.
mock.module("../src/services/capture-attempt-store.js", () => ({
  saveCaptureAttempt: async () => {},
}));

mock.module("../src/services/ai/ai-provider-factory.js", () => ({
  AIProviderFactory: {
    createProvider: () => ({
      executeToolCall: async () => ({
        success: true,
        data: { type: "feature", summary: "", padding: "x".repeat(500) + secret },
      }),
    }),
  },
}));

const { createPiCaptureProvider } = await import("../src/adapters/pi/provider.js");
const { buildCaptureAttemptRecord, emitCaptureAttempt } =
  await import("../src/services/capture-diagnostics.js");

// The capture pipeline emits the record; do the same here so the test covers
// exactly what reaches the log for an invalid reply.
function emit(diagnostics: Record<string, unknown>) {
  const record = buildCaptureAttemptRecord(
    { host: "pi", sourceType: "live-capture", sessionId: "s" },
    diagnostics,
    "failed",
    1
  );
  emitCaptureAttempt(record, diagnostics, { memoryApiKey: secret });
}
const { generateOpenCodeAutoCaptureSummary } =
  await import("../src/adapters/opencode/auto-capture-summary.js");

describe("invalid capture reply logging", () => {
  it("logs only the reply length, never its content or the API key", async () => {
    logged.length = 0;
    const diagnostics: Record<string, unknown> = {};
    const provider = createPiCaptureProvider(() => ({
      provider: "test",
      modelId: "example",
      complete: async () => ({
        content: [{ type: "text", text: `${"x".repeat(490)}${secret}${"y".repeat(60)}` }],
      }),
    }));
    await expect(
      provider.summarize({ userPrompt: "hi", context: "hi", diagnostics } as never)
    ).rejects.toThrow("invalid summary");
    emit(diagnostics);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      provider: "test",
      model: "example",
      replyChars: 572,
      reason: "invalid-json",
    });
    expect(logged[0]).not.toHaveProperty("reply");
    expect(JSON.stringify(logged)).not.toContain("xxxx");
    expect(JSON.stringify(logged)).not.toContain(secret);
  });

  it("logs only the invalid OpenCode reply length without leaking content", async () => {
    logged.length = 0;
    const diagnostics: Record<string, unknown> = {};
    await expect(
      generateOpenCodeAutoCaptureSummary({
        userPrompt: "hi",
        context: "hi",
        sessionId: "s",
        diagnostics,
      } as never)
    ).rejects.toThrow("invalid summary");
    emit(diagnostics);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      provider: "openai-chat",
      model: "example",
      reason: "schema-mismatch",
    });
    expect(logged[0]?.replyChars).toBeGreaterThan(500);
    expect(logged[0]).not.toHaveProperty("reply");
    expect(JSON.stringify(logged)).not.toContain("xxxx");
    expect(JSON.stringify(logged)).not.toContain(secret);
  });
});
