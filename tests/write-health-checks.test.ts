import { expect, it, mock } from "bun:test";
import { join } from "node:path";

const opened: string[] = [];
let embedMessage = "";

mock.module("../src/services/turso/connection-manager.js", () => ({
  tursoConnectionManager: {
    getConnection: async (path: string) => {
      opened.push(path);
      return { all: async () => [] };
    },
  },
}));
mock.module("../src/services/embedding.js", () => ({
  embeddingService: {
    embedWithTimeout: async () => {
      throw new Error(embedMessage);
    },
  },
}));

const { CONFIG } = await import("../src/config.js");
const { checkWriteHealth } = await import("../src/services/write-health-checks.js");

it("reads the store folder and the secrets from the config passed in, on every check", async () => {
  const previous = { ...CONFIG };
  try {
    CONFIG.storagePath = "/tmp/omms-health-a";
    CONFIG.embeddingApiKey = "embed-key-aaa";
    CONFIG.memoryApiKey = "memory-key-aaa";
    embedMessage = "server said embed-key-aaa and memory-key-aaa";
    const first = await checkWriteHealth(true, CONFIG);
    expect(first.reason).not.toContain("embed-key-aaa");
    expect(first.reason).not.toContain("memory-key-aaa");

    CONFIG.storagePath = "/tmp/omms-health-b";
    CONFIG.embeddingApiKey = "embed-key-bbb";
    CONFIG.memoryApiKey = "memory-key-bbb";
    embedMessage = "server said embed-key-bbb and memory-key-bbb";
    const second = await checkWriteHealth(true, CONFIG);
    expect(second.reason).not.toContain("embed-key-bbb");
    expect(second.reason).not.toContain("memory-key-bbb");
    expect(second.reason).toContain("[redacted]");
    expect(opened).toEqual([
      join("/tmp/omms-health-a", "user-prompts.db"),
      join("/tmp/omms-health-b", "user-prompts.db"),
    ]);
  } finally {
    Object.assign(CONFIG, previous);
  }
});
