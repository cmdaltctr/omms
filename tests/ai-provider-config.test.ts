import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMemoryProviderConfig } from "../src/services/ai/provider-config.js";
import { isLocalApiUrl } from "../src/services/ai/local-api-url.js";
import { applySafeExtraParams } from "../src/services/ai/providers/base-provider.js";
import { OpenAIChatCompletionProvider } from "../src/services/ai/providers/openai-chat-completion.js";
import { OpenAIResponsesProvider } from "../src/services/ai/providers/openai-responses.js";
import { GoogleGeminiProvider } from "../src/services/ai/providers/google-gemini.js";
import type { ChatCompletionTool } from "../src/services/ai/tools/tool-schema.js";

const toolSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "save_memory",
    description: "Save memory",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

class FakeSessionManager {
  private readonly session = { id: "session-1" };
  private readonly messages: any[] = [];

  getSession(): null {
    return null;
  }

  createSession(): { id: string } {
    return this.session;
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

describe("AI provider config", () => {
  const originalFetch = globalThis.fetch;
  const originalLogFileEnv = process.env.OMMS_LOG_FILE;
  const logDir = mkdtempSync(join(tmpdir(), "opencode-mem-logs-"));
  const logFile = join(logDir, "opencode-mem.log");

  process.env.OMMS_LOG_FILE = logFile;

  beforeEach(() => {
    rmSync(logFile, { force: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    if (originalLogFileEnv === undefined) {
      delete process.env.OMMS_LOG_FILE;
    } else {
      process.env.OMMS_LOG_FILE = originalLogFileEnv;
    }
    rmSync(logDir, { recursive: true, force: true });
  });

  it("builds provider config with memoryTemperature from runtime config", () => {
    const providerConfig = buildMemoryProviderConfig({
      memoryModel: "gpt-5-nano",
      memoryApiUrl: "https://api.openai.com/v1",
      memoryApiKey: "sk-test",
      memoryTemperature: false,
      autoCaptureMaxIterations: 7,
      autoCaptureIterationTimeout: 1234,
    });

    expect(providerConfig).toEqual({
      model: "gpt-5-nano",
      apiUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      memoryTemperature: false,
      maxIterations: 7,
      iterationTimeout: 1234,
    });
  });

  it("rejects placeholder API keys before a provider request is built", () => {
    expect(() =>
      buildMemoryProviderConfig({
        memoryModel: "gpt-4o-mini",
        memoryApiUrl: "https://api.openai.com/v1",
        memoryApiKey: "sk-...",
      })
    ).toThrow("replace the placeholder memoryApiKey value");
  });

  it("reports each missing manual provider field before a provider request is built", () => {
    expect(() => buildMemoryProviderConfig({})).toThrow(
      "missing memoryModel; missing memoryApiUrl; missing memoryApiKey"
    );
  });

  it("reports missing fields and placeholder API key together", () => {
    expect(() =>
      buildMemoryProviderConfig({
        memoryApiKey: "sk-...",
      })
    ).toThrow(
      "missing memoryModel; missing memoryApiUrl; replace the placeholder memoryApiKey value"
    );
  });

  it("recognises only an address on this machine as a local API URL", () => {
    for (const url of [
      "http://localhost:8080/v1",
      "http://127.0.0.1:9931/v1",
      "http://[::1]:8080/v1",
      "HTTP://LocalHost/v1",
    ]) {
      expect(isLocalApiUrl(url)).toBe(true);
    }
    for (const url of [
      "https://api.openai.com/v1",
      "http://localhost.example.com/v1",
      "http://192.168.1.20:8080/v1",
      "http://127.0.0.1.example.com/v1",
      "not a url",
      "",
      undefined,
    ]) {
      expect(isLocalApiUrl(url)).toBe(false);
    }
  });

  it("lets a caller that opts in skip the key for a local URL only", () => {
    const local = { memoryModel: "qwen", memoryApiUrl: "http://127.0.0.1:9931/v1" };
    expect(buildMemoryProviderConfig(local, { keylessForLocalUrl: true }).apiKey).toBe("");
    // Without the opt-in, capture, profile and import still need a key.
    expect(() => buildMemoryProviderConfig(local)).toThrow("missing memoryApiKey");
    // A remote URL needs a key even with the opt-in.
    expect(() =>
      buildMemoryProviderConfig(
        { memoryModel: "m", memoryApiUrl: "https://api.openai.com/v1" },
        { keylessForLocalUrl: true }
      )
    ).toThrow("missing memoryApiKey");
    // A key that is set still goes through, and a placeholder is still refused.
    expect(
      buildMemoryProviderConfig(
        { ...local, memoryApiKey: "real-key" },
        { keylessForLocalUrl: true }
      ).apiKey
    ).toBe("real-key");
    expect(() =>
      buildMemoryProviderConfig({ ...local, memoryApiKey: "sk-..." }, { keylessForLocalUrl: true })
    ).toThrow("replace the placeholder memoryApiKey value");
  });

  it("requires an API key for manual provider endpoints", () => {
    expect(() =>
      buildMemoryProviderConfig({
        memoryModel: "gpt-4o-mini",
        memoryApiUrl: "https://api.openai.com/v1",
      })
    ).toThrow("missing memoryApiKey");
  });

  it("builds orcarouter config from only an API key, defaulting model and endpoint", () => {
    const providerConfig = buildMemoryProviderConfig({
      memoryProvider: "orcarouter",
      memoryApiKey: "sk-orca-test",
    });

    expect(providerConfig).toEqual({
      model: "",
      apiUrl: "",
      apiKey: "sk-orca-test",
      maxIterations: undefined,
      iterationTimeout: undefined,
    });
  });

  it("still requires an API key for the orcarouter provider", () => {
    expect(() =>
      buildMemoryProviderConfig({
        memoryProvider: "orcarouter",
      })
    ).toThrow("missing memoryApiKey");
  });

  it("omits temperature for openai-chat when memoryTemperature is false", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "bad request",
      } as Response;
    }) as typeof fetch;

    const provider = new OpenAIChatCompletionProvider(
      {
        model: "gpt-5-nano",
        apiUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        memoryTemperature: false,
      },
      new FakeSessionManager() as any
    );

    await provider.executeToolCall("system", "user", toolSchema, "session-id");

    expect(capturedBody).toBeDefined();
    expect(capturedBody?.temperature).toBeUndefined();
  });

  it("uses provided temperature for openai-chat when explicitly configured", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "bad request",
      } as Response;
    }) as typeof fetch;

    const provider = new OpenAIChatCompletionProvider(
      {
        model: "gpt-4.1-mini",
        apiUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        memoryTemperature: 1,
      },
      new FakeSessionManager() as any
    );

    await provider.executeToolCall("system", "user", toolSchema, "session-id");

    expect(capturedBody?.temperature).toBe(1);
  });

  it("logs provider and model context for openai-chat API errors", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "bad request",
      } as Response;
    }) as unknown as typeof fetch;

    const beforeLog = existsSync(logFile) ? readFileSync(logFile, "utf-8") : "";

    const provider = new OpenAIChatCompletionProvider(
      {
        model: "gpt-5-nano",
        apiUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        memoryTemperature: false,
      },
      new FakeSessionManager() as any
    );

    await provider.executeToolCall("system", "user", toolSchema, "session-id");

    const afterLog = readFileSync(logFile, "utf-8");
    const appendedLog = afterLog.slice(beforeLog.length);

    expect(appendedLog).toContain('"provider":"openai-chat"');
    expect(appendedLog).toContain('"model":"gpt-5-nano"');
  });

  it("logs provider and model context for response-body API errors", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: true,
        json: async () => ({ status: 500, msg: "body failure" }),
      } as Response;
    }) as unknown as typeof fetch;

    const beforeLog = existsSync(logFile) ? readFileSync(logFile, "utf-8") : "";

    const provider = new OpenAIChatCompletionProvider(
      {
        model: "gpt-5-nano",
        apiUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        memoryTemperature: false,
      },
      new FakeSessionManager() as any
    );

    await provider.executeToolCall("system", "user", toolSchema, "session-id");

    const afterLog = readFileSync(logFile, "utf-8");
    const appendedLog = afterLog.slice(beforeLog.length);

    expect(appendedLog).toContain('"provider":"openai-chat"');
    expect(appendedLog).toContain('"model":"gpt-5-nano"');
  });

  it("never sends temperature for openai-responses", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "bad request",
      } as Response;
    }) as typeof fetch;

    const provider = new OpenAIResponsesProvider(
      {
        model: "gpt-5-nano",
        apiUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        memoryTemperature: false,
      },
      new FakeSessionManager() as any
    );

    await provider.executeToolCall("system", "user", toolSchema, "session-id");

    expect(capturedBody).toBeDefined();
    expect(capturedBody?.temperature).toBeUndefined();
  });

  it("sends no credential when the key is empty, for openai-responses and gemini", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "x",
      } as Response;
    }) as typeof fetch;
    const config = (apiKey: string) => ({
      model: "m",
      apiUrl: "http://127.0.0.1:8080/v1",
      apiKey,
      memoryTemperature: false as const,
      maxIterations: 1,
    });

    await new OpenAIResponsesProvider(config(""), new FakeSessionManager() as any)
      .executeToolCall("system", "user", toolSchema, "session-id")
      .catch(() => undefined);
    await new GoogleGeminiProvider(config(""), new FakeSessionManager() as any)
      .executeToolCall("system", "user", toolSchema, "session-id")
      .catch(() => undefined);
    expect(seen).toHaveLength(2);
    expect(Object.keys(seen[0]!.headers).map((name) => name.toLowerCase())).not.toContain(
      "authorization"
    );
    expect(seen[1]!.url).not.toContain("key=");

    // A key that is set is still sent.
    seen.length = 0;
    await new OpenAIResponsesProvider(config("real-key"), new FakeSessionManager() as any)
      .executeToolCall("system", "user", toolSchema, "session-id")
      .catch(() => undefined);
    expect(seen[0]!.headers.Authorization).toBe("Bearer real-key");
  });

  describe("applySafeExtraParams", () => {
    it("copies allowable extra parameters to request body", () => {
      const body: Record<string, unknown> = { model: "gpt-5-nano" };
      applySafeExtraParams(body, {
        top_p: 0.8,
        enable_thinking: false,
        custom_header: "val",
      });

      expect(body).toEqual({
        model: "gpt-5-nano",
        top_p: 0.8,
        enable_thinking: false,
        custom_header: "val",
      });
    });

    it("blocks protected keys from overriding core request structure", () => {
      const body: Record<string, unknown> = {
        model: "gpt-5-nano",
        messages: [{ role: "system", content: "hi" }],
      };
      applySafeExtraParams(body, {
        model: "override-model",
        messages: [{ role: "user", content: "override" }],
        tools: ["fake-tool"],
        tool_choice: "none",
        temperature: 0.9,
        input: "override-input",
        instructions: "override-instructions",
        conversation: "override-convo",
        stream: true,
      });

      expect(body).toEqual({
        model: "gpt-5-nano",
        messages: [{ role: "system", content: "hi" }],
      });
      expect(body.stream).toBeUndefined();
    });
  });
});
