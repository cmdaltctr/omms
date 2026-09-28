import { afterEach, describe, expect, it } from "bun:test";
import { AnthropicMessagesProvider } from "../src/services/ai/providers/anthropic-messages.js";
import { GoogleGeminiProvider } from "../src/services/ai/providers/google-gemini.js";
import { OpenAIChatCompletionProvider } from "../src/services/ai/providers/openai-chat-completion.js";
import { OpenAIResponsesProvider } from "../src/services/ai/providers/openai-responses.js";
import type { ChatCompletionTool } from "../src/services/ai/tools/tool-schema.js";
import { readJson } from "../src/adapters/opencode/opencode-diagnostics.js";

const toolSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "save_memory",
    description: "Save memory",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

class FakeSessionManager {
  private readonly messages: any[] = [];
  getSession(): any {
    return null;
  }
  createSession(): any {
    return { id: "session-1" };
  }
  getMessages(): any[] {
    return this.messages;
  }
  getLastSequence(): number {
    return this.messages.length - 1;
  }
  addMessage(message: any): void {
    this.messages.push(message);
  }
  updateSession(): void {}
}

const config = {
  model: "m",
  apiUrl: "https://example.invalid/v1",
  apiKey: "k",
  maxIterations: 1,
  iterationTimeout: 5000,
};

function replyWith(body: unknown) {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as Response) as unknown as typeof fetch;
}

describe("external API providers report their stop reason", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("OpenAI chat completions", async () => {
    replyWith({
      choices: [{ message: { role: "assistant", content: '{"summ' }, finish_reason: "length" }],
    });
    const provider = new OpenAIChatCompletionProvider(config, new FakeSessionManager() as any);
    const result = await provider.executeToolCall("s", "u", toolSchema, "id");
    expect(result.success).toBe(false);
    expect(result.stopReason).toBe("length");
  });

  it("OpenAI responses", async () => {
    replyWith({
      id: "r",
      object: "response",
      model: "m",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "message", content: [{ type: "output_text", text: '{"summ' }] }],
    });
    const provider = new OpenAIResponsesProvider(config, new FakeSessionManager() as any);
    const result = await provider.executeToolCall("s", "u", toolSchema, "id");
    expect(result.success).toBe(false);
    expect(result.stopReason).toBe("max_output_tokens");
  });

  it("Anthropic messages", async () => {
    replyWith({
      id: "msg",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: '{"summ' }],
      stop_reason: "max_tokens",
    });
    const provider = new AnthropicMessagesProvider(config, new FakeSessionManager() as any);
    const result = await provider.executeToolCall("s", "u", toolSchema, "id");
    expect(result.success).toBe(false);
    expect(result.stopReason).toBe("max_tokens");
  });

  it("Google Gemini", async () => {
    replyWith({
      candidates: [
        { content: { role: "model", parts: [{ text: '{"summ' }] }, finishReason: "MAX_TOKENS" },
      ],
    });
    const provider = new GoogleGeminiProvider(config, new FakeSessionManager() as any);
    const result = await provider.executeToolCall("s", "u", toolSchema, "id");
    expect(result.success).toBe(false);
    expect(result.stopReason).toBe("MAX_TOKENS");
  });
});

describe("model call failures report their HTTP status", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function failWith(status: number, retryAfter?: string) {
    globalThis.fetch = (async () =>
      new Response("busy", {
        status,
        headers: retryAfter ? { "Retry-After": retryAfter } : {},
      })) as unknown as typeof fetch;
  }

  it.each([
    ["OpenAI chat completions", OpenAIChatCompletionProvider],
    ["OpenAI responses", OpenAIResponsesProvider],
    ["Anthropic messages", AnthropicMessagesProvider],
    ["Google Gemini", GoogleGeminiProvider],
  ] as const)("%s sets httpStatus on a 503 reply", async (_name, Provider) => {
    failWith(503, "30");
    const provider = new Provider(config, new FakeSessionManager() as any);
    const result = await provider.executeToolCall("s", "u", toolSchema, "id");
    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(503);
    expect(result.retryAfterMs).toBe(30_000);
  });

  it.each([
    ["OpenAI chat completions", OpenAIChatCompletionProvider],
    ["OpenAI responses", OpenAIResponsesProvider],
    ["Anthropic messages", AnthropicMessagesProvider],
    ["Google Gemini", GoogleGeminiProvider],
  ] as const)(
    "%s marks a network failure, and not a bad reply, as a transport error",
    async (_name, Provider) => {
      globalThis.fetch = (async () => {
        throw new TypeError("Unable to connect");
      }) as unknown as typeof fetch;
      const provider = new Provider(config, new FakeSessionManager() as any);
      const down = await provider.executeToolCall("s", "u", toolSchema, "id");
      expect(down).toMatchObject({ success: false, transportError: true });

      replyWith({});
      const bad = await new Provider(config, new FakeSessionManager() as any).executeToolCall(
        "s",
        "u",
        toolSchema,
        "id"
      );
      expect(bad.success).toBe(false);
      expect(bad.transportError).toBeFalsy();
      expect(bad.httpStatus).toBeUndefined();
    }
  );

  it("OpenCode server calls attach httpStatus to the thrown error", async () => {
    const res = new Response("busy", { status: 503 });
    const error = await readJson(res, { label: "POST /session", url: "http://x/session" }).catch(
      (e: unknown) => e
    );
    expect((error as { httpStatus?: number }).httpStatus).toBe(503);
  });
});
