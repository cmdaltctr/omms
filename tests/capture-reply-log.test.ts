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
const { generateOpenCodeAutoCaptureSummary } =
  await import("../src/adapters/opencode/auto-capture-summary.js");

describe("invalid capture reply logging", () => {
  it("logs only the reply length, never its content or the API key", async () => {
    logged.length = 0;
    const provider = createPiCaptureProvider(() => ({
      provider: "test",
      modelId: "example",
      complete: async () => ({
        content: [{ type: "text", text: `${"x".repeat(490)}${secret}${"y".repeat(60)}` }],
      }),
    }));
    await expect(provider.summarize({ userPrompt: "hi", context: "hi" } as never)).rejects.toThrow(
      "invalid summary"
    );
    expect(logged[0]).toMatchObject({ provider: "test", modelId: "example", replyLength: 572 });
    expect(logged[0]).not.toHaveProperty("reply");
    expect(JSON.stringify(logged)).not.toContain("xxxx");
    expect(JSON.stringify(logged)).not.toContain(secret);
  });

  it("logs only the invalid OpenCode reply length without leaking content", async () => {
    logged.length = 0;
    await expect(
      generateOpenCodeAutoCaptureSummary({
        userPrompt: "hi",
        context: "hi",
        sessionId: "s",
      } as never)
    ).rejects.toThrow("invalid summary");
    expect(logged[0]).toMatchObject({ provider: "openai-chat", modelId: "example" });
    expect(logged[0]?.replyLength).toBeGreaterThan(500);
    expect(logged[0]).not.toHaveProperty("reply");
    expect(JSON.stringify(logged)).not.toContain("xxxx");
    expect(JSON.stringify(logged)).not.toContain(secret);
  });
});
