import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";

const structuredCalls: any[] = [];
const fakeHost = { tag: "opencode-host" };

mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  loadOpencodeProvider: async () => ({
    generateStructuredOutput: async (args: any) => {
      structuredCalls.push(args);
      return args.schema.parse({ duplicate: true, reason: "same" });
    },
    resolveOpencodeModelRef: (ref: any) => ref,
    getOpencodeHost: () => undefined,
  }),
}));
mock.module("../src/adapters/opencode/profile-llm-client.js", () => ({
  getOpencodeProfileHost: async () => fakeHost,
}));

const { adaptOpencodeProfileModel } = await import("../src/adapters/opencode/profile-model.js");

const hostModel = { providerID: "openai", modelID: "gpt-test" };

describe("adaptOpencodeProfileModel", () => {
  it("sends structured calls to OpenCode structured output with the same prompts", async () => {
    const port = adaptOpencodeProfileModel({} as any, hostModel);
    const schema = z.object({ duplicate: z.boolean(), reason: z.string() });

    const result = await port.completeStructured!("system prompt", "user prompt", schema);

    expect(result).toEqual({ duplicate: true, reason: "same" });
    expect(port.provider).toBe("openai");
    expect(port.modelId).toBe("gpt-test");
    expect(structuredCalls).toHaveLength(1);
    expect(structuredCalls[0]).toMatchObject({
      host: fakeHost,
      providerID: "openai",
      modelID: "gpt-test",
      systemPrompt: "system prompt",
      userPrompt: "user prompt",
    });
    expect(structuredCalls[0].schema).toBe(schema);
  });

  it("sends plain calls as one sessionless generation and trims the reply", async () => {
    const generateCalls: any[] = [];
    const host = {
      generate: {
        text: async (args: any) => {
          generateCalls.push(args);
          return { text: '  {"ok":true}\n' };
        },
      },
    };
    const port = adaptOpencodeProfileModel(host as any, hostModel);

    expect(await port.complete("cleanup system", "cleanup user")).toBe('{"ok":true}');
    expect(generateCalls).toEqual([
      {
        prompt: "cleanup system\n\ncleanup user",
        model: { providerID: "openai", id: "gpt-test" },
      },
    ]);
  });
});
