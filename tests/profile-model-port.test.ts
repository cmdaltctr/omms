import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { CONFIG } from "../src/config.js";
import type { ModelPort } from "../src/core/profile-analysis.js";
import {
  completeStructured,
  registerHostProfileModel,
} from "../src/services/user-profile/profile-model.js";

const DEDUP_SYSTEM = "You are a semantic duplicate detector. Output valid JSON.";
const CONFLICT_SYSTEM = "You are a preference contradiction detector. Output valid JSON.";

const storage = mkdtempSync(join(tmpdir(), "omms-profile-model-port-"));
const original = {
  storagePath: CONFIG.storagePath,
  memoryModel: CONFIG.memoryModel,
  memoryApiUrl: CONFIG.memoryApiUrl,
  fetch: globalThis.fetch,
};
let manager: any;

beforeAll(async () => {
  CONFIG.storagePath = storage;
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  manager = new UserProfileManager();
});

afterEach(() => {
  registerHostProfileModel(null);
  CONFIG.memoryModel = original.memoryModel;
  CONFIG.memoryApiUrl = original.memoryApiUrl;
  globalThis.fetch = original.fetch;
});

process.on("exit", () => {
  CONFIG.storagePath = original.storagePath;
  rmSync(storage, { recursive: true, force: true });
});

function recordingPort(reply: unknown) {
  const calls: Array<{ system: string; user: string }> = [];
  const port: ModelPort = {
    provider: "openai",
    modelId: "gpt-test",
    complete: async () => {
      throw new Error("complete must not be called when structured output exists");
    },
    async completeStructured(system, user, schema) {
      calls.push({ system, user });
      return schema.parse(reply);
    },
  };
  return { port, calls };
}

function externalApi(content: unknown) {
  const bodies: any[] = [];
  CONFIG.memoryModel = "gpt-ext";
  CONFIG.memoryApiUrl = "http://example.test/v1";
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] })
    );
  }) as typeof fetch;
  return bodies;
}

describe("profile manager model routing", () => {
  it("sends the duplicate check to the registered host model", async () => {
    const { port, calls } = recordingPort({ duplicate: true, reason: "same" });
    registerHostProfileModel(async () => port);
    const bodies = externalApi({ duplicate: false });

    expect(await manager.checkSemanticDuplicate("likes tabs", "prefers tabs")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toBe(DEDUP_SYSTEM);
    expect(calls[0]!.user).toContain('A: "likes tabs"');
    expect(calls[0]!.user).toContain('B: "prefers tabs"');
    expect(bodies).toHaveLength(0);
  });

  it("sends the conflict check to the registered host model", async () => {
    const { port, calls } = recordingPort({ conflict: true, reason: "opposite" });
    registerHostProfileModel(async () => port);
    externalApi({ conflict: false });

    expect(await manager.checkConflict("likes tabs", "hates tabs")).toBe(true);
    expect(calls[0]!.system).toBe(CONFLICT_SYSTEM);
  });

  it("uses the external API with the same prompt when no host model is registered", async () => {
    const { port, calls } = recordingPort({ duplicate: false, reason: "different" });
    const bodies = externalApi({ duplicate: true });

    expect(await manager.checkSemanticDuplicate("likes tabs", "prefers tabs")).toBe(true);
    registerHostProfileModel(async () => port);
    await manager.checkSemanticDuplicate("likes tabs", "prefers tabs");

    expect(bodies).toHaveLength(1);
    expect(bodies[0].messages[0].content).toBe(DEDUP_SYSTEM);
    expect(bodies[0].messages[1].content).toBe(calls[0]!.user);
  });

  it("uses the external API when the registered host resolves no model", async () => {
    registerHostProfileModel(async () => null);
    const bodies = externalApi({ conflict: true });

    expect(await manager.checkConflict("likes tabs", "hates tabs")).toBe(true);
    expect(bodies).toHaveLength(1);
  });

  it("falls back to the external API when the host model fails", async () => {
    registerHostProfileModel(async () => ({
      provider: "openai",
      modelId: "gpt-test",
      complete: async () => "",
      completeStructured: async () => {
        throw new Error("provider not connected");
      },
    }));
    const bodies = externalApi({ duplicate: true });

    expect(await manager.checkSemanticDuplicate("a b c", "a b d")).toBe(true);
    expect(bodies).toHaveLength(1);
  });
});

describe("completeStructured", () => {
  it("parses and validates a plain-text reply when the port has no structured output", async () => {
    const port: ModelPort = {
      provider: "pi",
      modelId: "m",
      complete: async () => 'Sure: {"description": "Prefers tabs"}',
    };
    const schema = z.object({ description: z.string() });
    expect(await completeStructured(port, "s", "u", schema)).toEqual({
      description: "Prefers tabs",
    });
    await expect(
      completeStructured({ ...port, complete: async () => '{"other": 1}' }, "s", "u", schema)
    ).rejects.toThrow();
  });
});
