import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";

const structuredCalls: any[] = [];
const fakeClient = { tag: "opencode-client" };

mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  loadOpencodeProvider: async () => ({
    generateStructuredOutput: async (args: any) => {
      structuredCalls.push(args);
      return args.schema.parse({ duplicate: true, reason: "same" });
    },
    resolveOpencodeModelRef: (ref: any) => ref,
    getV2Client: () => null,
  }),
}));
mock.module("../src/adapters/opencode/profile-llm-client.js", () => ({
  getOpenCodeClient: async () => fakeClient,
}));

const { adaptOpencodeProfileModel } = await import("../src/adapters/opencode/profile-model.js");

const hostModel = { providerID: "openai", modelID: "gpt-test" };

describe("adaptOpencodeProfileModel", () => {
  it("sends structured calls to OpenCode structured output with the same prompts", async () => {
    const port = adaptOpencodeProfileModel({}, hostModel);
    const schema = z.object({ duplicate: z.boolean(), reason: z.string() });

    const result = await port.completeStructured!("system prompt", "user prompt", schema);

    expect(result).toEqual({ duplicate: true, reason: "same" });
    expect(port.provider).toBe("openai");
    expect(port.modelId).toBe("gpt-test");
    expect(structuredCalls).toHaveLength(1);
    expect(structuredCalls[0]).toMatchObject({
      client: fakeClient,
      providerID: "openai",
      modelID: "gpt-test",
      systemPrompt: "system prompt",
      userPrompt: "user prompt",
    });
    expect(structuredCalls[0].schema).toBe(schema);
  });

  it("sends plain calls through a cleanup session and deletes it", async () => {
    const calls: string[] = [];
    let prompt: any;
    const v2Client = {
      session: {
        create: async (args: any) => {
          calls.push(`create:${args.title}`);
          return { data: { id: "s1" } };
        },
        prompt: async (args: any) => {
          prompt = args;
          return { data: { info: {}, parts: [{ type: "text", text: '{"ok":true}' }] } };
        },
        delete: async (args: any) => {
          calls.push(`delete:${args.sessionID}`);
        },
      },
    };
    const port = adaptOpencodeProfileModel(v2Client, hostModel);

    expect(await port.complete("cleanup system", "cleanup user")).toBe('{"ok":true}');
    expect(calls).toEqual(["create:omms profile cleanup", "delete:s1"]);
    expect(prompt).toMatchObject({
      sessionID: "s1",
      model: hostModel,
      system: "cleanup system",
      parts: [{ type: "text", text: "cleanup user" }],
      noReply: false,
    });
  });
});
