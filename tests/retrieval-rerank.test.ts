import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SearchResult } from "../src/services/turso/types.js";
import { rerankedSearch, type SearchAcrossShards } from "../src/services/retrieval-rerank.js";
import { RERANKER_POOL_SIZE } from "../src/services/request-timeouts.js";

const SETTINGS = {
  apiUrl: "http://127.0.0.1:3008/v1",
  model: "Qwen3-Reranker-0.6B",
  timeoutMs: 2000,
};

function candidate(id: string, similarity: number): SearchResult {
  return { id, memory: `memory of ${id}`, similarity };
}

/** A shard-search spy returning canned candidates in score order. */
function searchSpy(candidates: SearchResult[]) {
  const calls: Array<{ limit: number; threshold: number; query?: string }> = [];
  const search: SearchAcrossShards = async (_shards, _vector, _tag, limit, threshold, query) => {
    calls.push({ limit, threshold, query });
    return { results: candidates, warnings: [] };
  };
  return { search, calls };
}

function fakeFetchWithScores(
  scores: number[],
  fetchCalls: Array<{ url: string; body: any }> = []
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({
      results: scores.map((score, index) => ({ index, relevance_score: score })),
    });
  }) as typeof fetch;
}

describe("rerankedSearch", () => {
  it("reads the shard search once with no threshold and the pool limit", async () => {
    const { search, calls } = searchSpy([candidate("mem_a", 0.9)]);
    await rerankedSearch(
      {
        shards: [],
        queryVector: new Float32Array([1]),
        containerTag: "omms_project_0123456789abcdef",
        queryText: "the query",
        maxMemories: 10,
        similarityThreshold: 0.5,
      },
      SETTINGS,
      { search, fetchImpl: fakeFetchWithScores([0.5]) }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.limit).toBe(Math.max(10, RERANKER_POOL_SIZE));
    expect(calls[0]!.threshold).toBe(0);
    expect(calls[0]!.query).toBe("the query");
  });

  it("lifts a candidate below the similarity threshold when the reranker ranks it first", async () => {
    const low = candidate("mem_low", 0.42);
    const high = candidate("mem_high", 0.75);
    const { search } = searchSpy([high, low]);
    const result = await rerankedSearch(
      {
        shards: [],
        queryVector: new Float32Array([1]),
        containerTag: "omms_project_0123456789abcdef",
        queryText: "the query",
        maxMemories: 10,
        similarityThreshold: 0.5,
      },
      SETTINGS,
      { search, fetchImpl: fakeFetchWithScores([0.2, 0.9]) }
    );
    expect(result.reranked).toBe(true);
    // The 0.42 memory is returned first even though it sits below 0.5.
    expect(result.results.map((r) => r.id)).toEqual(["mem_low", "mem_high"]);
  });

  it("keeps only maxMemories reranked results", async () => {
    const candidates = Array.from({ length: 50 }, (_, i) =>
      candidate(`mem_${String(i).padStart(2, "0")}`, 0.9 - i * 0.01)
    );
    const { search } = searchSpy(candidates);
    // Reverse scores: the worst similarity becomes the best rerank result.
    const scores = candidates.map((_, i) => i / 100);
    const result = await rerankedSearch(
      {
        shards: [],
        queryVector: new Float32Array([1]),
        containerTag: "omms_project_0123456789abcdef",
        queryText: "the query",
        maxMemories: 6,
        similarityThreshold: 0.5,
      },
      SETTINGS,
      { search, fetchImpl: fakeFetchWithScores(scores) }
    );
    expect(result.results).toHaveLength(6);
    expect(result.results.map((r) => r.id)).toEqual([
      "mem_49",
      "mem_48",
      "mem_47",
      "mem_46",
      "mem_45",
      "mem_44",
    ]);
  });

  it("returns the threshold result when the reranker fails, with a metadata-only log record", async () => {
    const low = candidate("mem_low", 0.42);
    const high = candidate("mem_high", 0.75);
    const { search } = searchSpy([high, low]);
    const logs: Array<[string, Record<string, unknown>]> = [];
    const failingFetch = (async () => {
      throw new TypeError("connect ECONNREFUSED");
    }) as typeof fetch;
    const result = await rerankedSearch(
      {
        shards: [],
        queryVector: new Float32Array([1]),
        containerTag: "omms_project_0123456789abcdef",
        queryText: "secret query text",
        maxMemories: 10,
        similarityThreshold: 0.5,
      },
      SETTINGS,
      { search, fetchImpl: failingFetch, log: (message, meta) => logs.push([message, meta]) }
    );
    expect(result.reranked).toBe(false);
    // The 0.42 memory is cut by the threshold, exactly as with the reranker off.
    expect(result.results.map((r) => r.id)).toEqual(["mem_high"]);
    expect(logs).toHaveLength(1);
    const [message, meta] = logs[0]!;
    expect(String(meta.code)).toMatch(/^reranker_/);
    expect(typeof meta.elapsedMs).toBe("number");
    expect(meta.candidates).toBe(2);
    // Metadata only: no query and no memory text anywhere in the record.
    expect(JSON.stringify([message, meta])).not.toContain("secret query text");
    expect(JSON.stringify([message, meta])).not.toContain("memory of mem_high");
  });

  it("skips the reranker call when the shard search finds no candidates", async () => {
    const { search } = searchSpy([]);
    const fetchCalls: Array<{ url: string; body: any }> = [];
    const result = await rerankedSearch(
      {
        shards: [],
        queryVector: new Float32Array(1),
        containerTag: "tag",
        queryText: "q",
        maxMemories: 3,
        similarityThreshold: 0.5,
      },
      SETTINGS,
      { search, fetchImpl: fakeFetchWithScores([], fetchCalls) }
    );
    expect(fetchCalls).toHaveLength(0);
    expect(result).toEqual({ results: [], warnings: [], reranked: false });
  });

  it("keeps shard warnings on both paths", async () => {
    const warned: SearchResult[] = [candidate("mem_a", 0.8)];
    const search: SearchAcrossShards = async () => ({
      results: warned,
      warnings: ["partial shard failure"],
    });
    for (const fetchImpl of [
      fakeFetchWithScores([0.5]),
      (async () => {
        throw new TypeError("down");
      }) as typeof fetch,
    ]) {
      const result = await rerankedSearch(
        {
          shards: [],
          queryVector: new Float32Array([1]),
          containerTag: "tag",
          queryText: "q",
          maxMemories: 10,
          similarityThreshold: 0.5,
        },
        SETTINGS,
        { search, fetchImpl }
      );
      expect(result.warnings).toEqual(["partial shard failure"]);
    }
  });
});

/**
 * Client wiring runs in a child process: config, the embedding service, the
 * shard manager, and the shard search are mocked, so the real
 * memoryClient.searchMemories exercises the reranker decision with a fake
 * global fetch.
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const configUrl = new URL("../src/config.js", import.meta.url).href;
const clientUrl = new URL("../src/services/client.js", import.meta.url).href;
const embeddingUrl = new URL("../src/services/embedding.js", import.meta.url).href;
const shardManagerUrl = new URL("../src/services/turso/shard-manager.js", import.meta.url).href;
const vectorSearchUrl = new URL("../src/services/turso/vector-search.js", import.meta.url).href;
const readyUrl = new URL("../src/services/turso/ready.js", import.meta.url).href;
const connectionUrl = new URL("../src/services/turso/connection-manager.js", import.meta.url).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const contextUrl = new URL("../src/services/context.js", import.meta.url).href;

function runClientScenario(
  code: string,
  options: { configExtra?: Record<string, unknown>; fetchReply?: unknown } = {}
): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-rerank-client-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const searchCalls = [];
const fetchCalls = [];
const logs = [];
let candidates = [];

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: {
    maxMemories: 10,
    similarityThreshold: 0.5,
    chatMessage: { excludeCurrentSession: true },
    ...JSON.parse(process.env.OMMS_TEST_CONFIG_EXTRA ?? "{}"),
  },
}));
mock.module(${JSON.stringify(loggerUrl)}, () => ({
  log: (message, meta) => logs.push({ message, ...meta }),
}));
mock.module(${JSON.stringify(embeddingUrl)}, () => ({
  embeddingService: { embedWithTimeout: async () => new Float32Array([0.1]) },
}));
mock.module(${JSON.stringify(readyUrl)}, () => ({
  ensureTursoReady: async () => {},
}));
mock.module(${JSON.stringify(shardManagerUrl)}, () => ({
  tursoShardManager: { getAllShards: async () => [{ id: 1, dbPath: "/tmp/none.db" }] },
}));
mock.module(${JSON.stringify(connectionUrl)}, () => ({
  tursoConnectionManager: { getConnection: async () => { throw new Error("unused"); } },
}));
mock.module(${JSON.stringify(vectorSearchUrl)}, () => ({
  tursoVectorSearch: {
    searchAcrossShards: async (shards, queryVector, containerTag, limit, threshold, query) => {
      searchCalls.push({ limit, threshold, query, containerTag });
      // Same cut as the real implementation: threshold first, then the limit.
      const results = candidates
        .filter((result) => result.similarity >= threshold)
        .slice(0, limit);
      return { results, warnings: [] };
    },
  },
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  const reply = JSON.parse(process.env.OMMS_TEST_FETCH_REPLY ?? "{}");
  return Response.json(reply);
};

const { memoryClient } = await import(${JSON.stringify(clientUrl)});
let captured;
${code}
globalThis.fetch = originalFetch;
console.log(JSON.stringify({ captured, searchCalls, fetchCalls, logs }));
`;
  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", scriptPath], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      OMMS_TEST_CONFIG_EXTRA: JSON.stringify(options.configExtra ?? {}),
      OMMS_TEST_FETCH_REPLY: JSON.stringify(options.fetchReply ?? {}),
    },
  });
  const stdout = new TextDecoder().decode(proc.stdout).trim();
  if (proc.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(proc.stderr));
  }
  return JSON.parse(stdout.split("\n").pop()!);
}

const memoryOperationsUrl = new URL("../src/core/memory-operations.js", import.meta.url).href;
const retrievalUrl = new URL("../src/core/retrieval.js", import.meta.url).href;

/**
 * Full-chain host-path scenario: the real memoryClient runs over mocked
 * embedding/shard/search layers with a fake global fetch, so a call through
 * buildRetrievalSection (Pi, OpenCode V2, Claude Code) or the manual memory
 * search exercises the real reranker decision.
 */
function runHostScenario(
  code: string,
  options: { configExtra?: Record<string, unknown> } = {}
): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-rerank-host-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const searchCalls = [];
const fetchCalls = [];
const formatted = [];
let candidates = [];

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: {
    maxMemories: 10,
    similarityThreshold: 0.5,
    chatMessage: { excludeCurrentSession: true },
    memory: { defaultScope: "project" },
    autoCaptureLanguage: "en",
    ...JSON.parse(process.env.OMMS_TEST_CONFIG_EXTRA ?? "{}"),
  },
  isConfigured: () => true,
  refreshConfigIfChanged: () => {},
}));
mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));
mock.module(${JSON.stringify(embeddingUrl)}, () => ({
  embeddingService: {
    embedWithTimeout: async () => new Float32Array([0.1]),
    warmup: async () => {},
    isWarmedUp: true,
    initError: null,
  },
}));
mock.module(${JSON.stringify(readyUrl)}, () => ({ ensureTursoReady: async () => {} }));
mock.module(${JSON.stringify(shardManagerUrl)}, () => ({
  tursoShardManager: { getAllShards: async () => [{ id: 1, dbPath: "/tmp/none.db" }] },
}));
mock.module(${JSON.stringify(connectionUrl)}, () => ({
  tursoConnectionManager: { getConnection: async () => { throw new Error("unused"); } },
}));
mock.module(${JSON.stringify(vectorSearchUrl)}, () => ({
  tursoVectorSearch: {
    searchAcrossShards: async (shards, queryVector, containerTag, limit, threshold, query) => {
      searchCalls.push({ limit, threshold, query, containerTag });
      const results = candidates
        .filter((result) => result.similarity >= threshold)
        .slice(0, limit);
      return { results, warnings: [] };
    },
  },
}));
mock.module(${JSON.stringify(tagsUrl)}, () => ({
  getTags: () => ({
    project: { tag: "omms_project_0123456789abcdef" },
    user: { userEmail: "user@example.com" },
  }),
}));
mock.module(${JSON.stringify(contextUrl)}, () => ({
  formatContextForPrompt: async (userId, memories) => {
    formatted.push(memories.results.map((r) => r.id));
    return memories.results.map((r) => r.memory).join("|");
  },
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  const reply = JSON.parse(process.env.OMMS_TEST_FETCH_REPLY ?? "{}");
  return Response.json(reply);
};

const { memoryClient } = await import(${JSON.stringify(clientUrl)});
let captured;
${code}
globalThis.fetch = originalFetch;
console.log(JSON.stringify({ captured, searchCalls, fetchCalls, formatted }));
`;
  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", scriptPath], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      OMMS_TEST_CONFIG_EXTRA: JSON.stringify(options.configExtra ?? {}),
      OMMS_TEST_FETCH_REPLY: JSON.stringify(
        options.fetchReply ?? {
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.2 },
          ],
        }
      ),
    },
  });
  const stdout = new TextDecoder().decode(proc.stdout).trim();
  if (proc.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(proc.stderr));
  }
  return JSON.parse(stdout.split("\n").pop()!);
}

describe("host paths use the reranker", () => {
  const CANDIDATES = `
candidates = [
  { id: "mem_high", memory: "above the threshold", similarity: 0.75 },
  { id: "mem_low", memory: "below the threshold", similarity: 0.42 },
];
`;
  const RERANKER_ON = {
    rerankerEnabled: true,
    rerankerApiUrl: "http://127.0.0.1:3008/v1",
    rerankerModel: "Qwen3-Reranker-0.6B",
  };

  it("buildRetrievalSection (Pi, OpenCode V2, Claude Code) returns the reranked order", () => {
    const output = runHostScenario(
      `
${CANDIDATES}
const { buildRetrievalSection } = await import(${JSON.stringify(retrievalUrl)});
captured = await buildRetrievalSection("queue?", "/repo", "ses-1");
`,
      { configExtra: RERANKER_ON }
    );
    // The 0.42 memory is lifted above the 0.5 threshold and ordered first.
    expect(output.fetchCalls).toHaveLength(1);
    expect(output.formatted).toEqual([["mem_low", "mem_high"]]);
    expect(output.captured).toContain("below the threshold");
    expect(output.captured.indexOf("below")).toBeLessThan(output.captured.indexOf("above"));
  });

  it("the manual memory search uses the same reranked search", () => {
    const output = runHostScenario(
      `
${CANDIDATES}
const { executeMemoryOperation } = await import(${JSON.stringify(memoryOperationsUrl)});
captured = await executeMemoryOperation({ mode: "search", query: "queue?" }, { directory: "/repo" });
`,
      { configExtra: RERANKER_ON }
    );
    expect(output.fetchCalls).toHaveLength(1);
    expect(output.captured.success).toBe(true);
    const ids = output.captured.results.map((r: { id: string }) => r.id);
    expect(ids).toEqual(["mem_low", "mem_high"]);
    expect(output.captured.results[0].content).toBe("below the threshold");
  });

  it("the recent-memory list never calls the reranker or the search", () => {
    const output = runHostScenario(
      `
const { buildRecentMemoriesSection } = await import(${JSON.stringify(retrievalUrl)});
captured = await buildRecentMemoriesSection({
  projectTag: "omms_project_0123456789abcdef",
  userEmail: "user@example.com",
  sessionId: "ses-1",
});
`,
      { configExtra: RERANKER_ON }
    );
    expect(output.fetchCalls).toEqual([]);
    expect(output.searchCalls).toEqual([]);
  });

  it("every host prompt path routes through buildRetrievalSection", () => {
    const repoRoot = join(import.meta.dir, "..");
    for (const relative of [
      "src/adapters/pi/extension.ts",
      "src/v2/memory-bridge.ts",
      "src/importer/claude-hook-api.ts",
    ]) {
      const source = readFileSync(join(repoRoot, relative), "utf8");
      expect(source, relative).toContain("buildRetrievalSection");
    }
  });
});

describe("memoryClient.searchMemories reranker wiring", () => {
  it("with the reranker off, keeps today's search call and result untouched", () => {
    const output = runClientScenario(`
candidates = [
  { id: "mem_high", memory: "kept", similarity: 0.75 },
  { id: "mem_low", memory: "cut", similarity: 0.42 },
];
captured = await memoryClient.searchMemories("query", "omms_project_0123456789abcdef");
`);
    expect(output.searchCalls).toEqual([
      { limit: 10, threshold: 0.5, query: "query", containerTag: "omms_project_0123456789abcdef" },
    ]);
    expect(output.fetchCalls).toEqual([]);
    expect(output.captured.results.map((r: { id: string }) => r.id)).toEqual(["mem_high"]);
  });

  it("with the reranker on, reads the pool, calls the server, and returns the reranked order", () => {
    const output = runClientScenario(
      `
candidates = [
  { id: "mem_high", memory: "high memory", similarity: 0.75 },
  { id: "mem_low", memory: "low memory", similarity: 0.42 },
];
captured = await memoryClient.searchMemories("query", "omms_project_0123456789abcdef");
`,
      {
        configExtra: {
          rerankerEnabled: true,
          rerankerApiUrl: "http://127.0.0.1:3008/v1",
          rerankerModel: "Qwen3-Reranker-0.6B",
        },
        fetchReply: {
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.2 },
          ],
        },
      }
    );
    expect(output.searchCalls).toEqual([
      { limit: 50, threshold: 0, query: "query", containerTag: "omms_project_0123456789abcdef" },
    ]);
    expect(output.fetchCalls).toHaveLength(1);
    expect(output.fetchCalls[0].url).toBe("http://127.0.0.1:3008/v1/rerank");
    expect(output.fetchCalls[0].body.model).toBe("Qwen3-Reranker-0.6B");
    // The reply lifts index 1 (the 0.42 memory) to the top.
    expect(output.captured.results.map((r: { id: string }) => r.id)).toEqual([
      "mem_low",
      "mem_high",
    ]);
  });

  it("with the switch on but no URL, logs reranker_not_configured and searches normally", () => {
    const output = runClientScenario(
      `
candidates = [
  { id: "mem_high", memory: "kept", similarity: 0.75 },
  { id: "mem_low", memory: "cut", similarity: 0.42 },
];
captured = await memoryClient.searchMemories("query", "omms_project_0123456789abcdef");
`,
      { configExtra: { rerankerEnabled: true } }
    );
    expect(output.searchCalls).toEqual([
      { limit: 10, threshold: 0.5, query: "query", containerTag: "omms_project_0123456789abcdef" },
    ]);
    expect(output.fetchCalls).toEqual([]);
    expect(
      output.logs.some((entry: { code?: string }) => entry.code === "reranker_not_configured")
    ).toBe(true);
    expect(output.captured.results.map((r: { id: string }) => r.id)).toEqual(["mem_high"]);
  });

  it("snapshots the reranker settings at the start of the search", () => {
    const output = runClientScenario(
      `
candidates = [{ id: "mem_a", memory: "m", similarity: 0.9 }];
const { CONFIG } = await import(${JSON.stringify(configUrl)});
const search = memoryClient.searchMemories("query", "omms_project_0123456789abcdef");
// Flip the switch after entry, while awaits are still in flight.
CONFIG.rerankerEnabled = false;
captured = await search;
`,
      {
        configExtra: {
          rerankerEnabled: true,
          rerankerApiUrl: "http://127.0.0.1:3008/v1",
          rerankerModel: "Qwen3-Reranker-0.6B",
        },
        fetchReply: { results: [{ index: 0, relevance_score: 1 }] },
      }
    );
    // The entry snapshot had the reranker on, so the server was still called.
    expect(output.fetchCalls).toHaveLength(1);
    expect(output.captured.results.map((r: { id: string }) => r.id)).toEqual(["mem_a"]);
  });
});
