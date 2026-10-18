import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const url = (path: string) => new URL(path, import.meta.url).href;

const PROFILE = {
  preferences: [
    {
      category: "style",
      description: "Use British spelling",
      confidence: 0.9,
      frequency: 3,
      lastSeen: Date.now(),
      anchor: [0, 0, 1],
    },
    {
      category: "language",
      description: "Prefers TypeScript",
      confidence: 0.8,
      frequency: 3,
      lastSeen: Date.now(),
      anchor: [0, 1, 0],
    },
    {
      category: "tooling",
      description: "Use bun as the package manager",
      confidence: 0.1,
      frequency: 1,
      lastSeen: Date.now(),
      anchor: [1, 0, 0],
    },
  ],
  patterns: [],
  workflows: [],
};

/** Real client, context, and profile code; the store, embedder, and profile source are mocked. */
function runScenario(body: string, embedFails = false, config = ""): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-profile-injection-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const calls = { embed: 0, search: [] };

mock.module(${JSON.stringify(url("../src/services/embedding.js"))}, () => ({
  embeddingService: {
    isWarmedUp: true,
    warmup: async () => {},
    embedWithTimeout: async () => {
      calls.embed++;
      if (${embedFails}) throw new Error("embedding down");
      return new Float32Array([1, 0, 0]);
    },
  },
}));
mock.module(${JSON.stringify(url("../src/services/turso/shard-manager.js"))}, () => ({
  tursoShardManager: { getAllShards: async () => [{ id: 1, dbPath: "/tmp/none.db" }] },
}));
mock.module(${JSON.stringify(url("../src/services/turso/vector-search.js"))}, () => ({
  tursoVectorSearch: {
    listMemories: async () => [],
    searchAcrossShards: async (...args) => {
      calls.search.push(args.length);
      calls.keywordBoost = args[6];
      calls.keywordMode = args[7];
      return { results: [{ id: "m1", memory: "A project memory", similarity: 0.9 }], warnings: [] };
    },
  },
}));
mock.module(${JSON.stringify(url("../src/services/turso/connection-manager.js"))}, () => ({
  tursoConnectionManager: { getConnection: async () => ({}), closeAll: async () => {} },
}));
mock.module(${JSON.stringify(url("../src/services/turso/ready.js"))}, () => ({ ensureTursoReady: async () => {} }));
mock.module(${JSON.stringify(url("../src/services/logger.js"))}, () => ({
  log: (message, meta) => { (calls.logs ??= []).push([message, meta]); },
}));
mock.module(${JSON.stringify(url("../src/services/tags.js"))}, () => ({
  getTags: () => ({ project: { tag: "omms_project_a1b2c3d4e5f67890" }, user: { userEmail: "user@example.com" } }),
}));
mock.module(${JSON.stringify(url("../src/services/user-profile/user-profile-manager.js"))}, () => ({
  userProfileManager: { getActiveProfile: async () => ({ profileData: ${JSON.stringify(JSON.stringify(PROFILE))} }) },
}));
mock.module(${JSON.stringify(url("../src/config.js"))}, () => ({
  CONFIG: {
    maxMemories: 10, similarityThreshold: 0.5, keywordBoost: 0.15, injectProfile: true,
    userProfileInjectPreferences: 2, userProfileInjectPatterns: 1, userProfileInjectWorkflows: 1,
    chatMessage: { excludeCurrentSession: false },
    ${config}
  },
}));

const { buildRetrievalSection } = await import(${JSON.stringify(url("../src/core/retrieval.js"))});
const { formatContextForPrompt } = await import(${JSON.stringify(url("../src/services/context.js"))});
let out = {};
${body}
console.log("RESULT:" + JSON.stringify({ out, calls }));
`;
  writeFileSync(scriptPath, script);
  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8");
  const stderr = Buffer.from(result.stderr).toString("utf8");
  const match = stdout.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(`${stdout}\n${stderr}`);
  return JSON.parse(match[1] as string);
}

describe("profile block follows the prompt", () => {
  it("adds the item about the prompt and embeds the prompt once", () => {
    const { out, calls } = runScenario(
      `out.text = await buildRetrievalSection("which package manager?", "/tmp/project", "s1");`
    );
    expect(out.text).toContain("Use bun as the package manager");
    // Half of two slots goes to relevance, the other keeps the top preference.
    expect(out.text).toContain("Use British spelling");
    expect(out.text).not.toContain("Prefers TypeScript");
    expect(calls.embed).toBe(1);
  });

  it("passes keywordBoost to the shard search", () => {
    const { calls } = runScenario(`await buildRetrievalSection("anything", "/tmp/project", "s1");`);
    expect(calls.keywordBoost).toBe(0.15);
  });

  it("passes keywordMode rrf to the shard search", () => {
    const { calls } = runScenario(
      `await buildRetrievalSection("anything", "/tmp/project", "s1");`,
      false,
      `keywordMode: "rrf",`
    );
    expect(calls.keywordMode).toBe("rrf");
  });

  it("uses the boost, not rrf, while the reranker is on", () => {
    const { calls } = runScenario(
      `await buildRetrievalSection("anything", "/tmp/project", "s1");`,
      false,
      `keywordMode: "rrf", rerankerEnabled: true, rerankerApiUrl: "http://127.0.0.1:1", rerankerModel: "m", rerankerTimeoutMs: 500,`
    );
    expect(calls.keywordMode).toBeUndefined();
    expect(calls.keywordBoost).toBe(0.15);
  });

  it("keeps today's block when the search fails", () => {
    const { out, calls } = runScenario(
      `out.section = await buildRetrievalSection("which package manager?", "/tmp/project", "s1");
       out.text = await formatContextForPrompt("user@example.com", { results: [{ id: "m1", memory: "A project memory", similarity: 0.9 }] });`,
      true
    );
    expect(out.section).toBeNull();
    expect(out.text).toContain("Use British spelling");
    expect(out.text).toContain("Prefers TypeScript");
    expect(out.text).not.toContain("Use bun as the package manager");
    expect(calls.embed).toBe(1);
  });

  it("keeps today's block when there is no prompt, as at session start", () => {
    const { out, calls } = runScenario(
      `out.text = await formatContextForPrompt("user@example.com", { results: [{ id: "m1", memory: "Recent", similarity: 1 }] });`
    );
    expect(out.text).toContain("Use British spelling");
    expect(out.text).toContain("Prefers TypeScript");
    expect(out.text).not.toContain("Use bun as the package manager");
    expect(calls.embed).toBe(0);
  });

  it("logs counts, not the prompt", () => {
    const { calls } = runScenario(
      `await buildRetrievalSection("secret-prompt-words about packages", "/tmp/project", "s1");`
    );
    const injectLog = calls.logs.find(([message]: [string]) => message === "profile inject");
    expect(injectLog[1].relevanceSlots.prefs).toBe(1);
    expect(injectLog[1].counts.prefs).toBe(2);
    expect(JSON.stringify(calls.logs)).not.toContain("secret-prompt-words");
  });
});
