import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Each scenario spawns two Bun worker processes that write to a real store.
// Windows runners take about 4.5-5 s per scenario, right at Bun's 5 s default,
// so the repeated-runs scenario is killed before it reports a result.
setDefaultTimeout(30_000);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const configModule = pathToFileURL(join(import.meta.dir, "../src/config.js")).href;
const clientModule = pathToFileURL(join(import.meta.dir, "../src/services/client.js")).href;
const embeddingModule = pathToFileURL(join(import.meta.dir, "../src/services/embedding.js")).href;
const readyModule = pathToFileURL(join(import.meta.dir, "../src/services/turso/ready.js")).href;
const loggerModule = pathToFileURL(join(import.meta.dir, "../src/services/logger.js")).href;
const shardManagerModule = pathToFileURL(
  join(import.meta.dir, "../src/services/turso/shard-manager.js")
).href;

/**
 * Real-storage worker running the PRODUCTION write path
 * (memoryClient.addMemory -> withScopeWriteLock -> getWriteShard -> insert ->
 * increment) with only the embedding service and the ready gate stubbed.
 * Two of these run as separate processes against one shared storage
 * directory: genuine cross-process libSQL behaviour, no mocks in the storage
 * layer.
 */
const WORKER_SOURCE = `
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  })
);

const { mock } = await import("bun:test");
const embeddingStub = {
  embedWithTimeout: async () => new Float32Array([0.25, 0.5, 0.75, 1]),
  warmup: async () => {},
  isWarmedUp: true,
};
class EmbeddingServiceStub {
  static getInstance() {
    return embeddingStub;
  }
}
mock.module(${JSON.stringify(embeddingModule)}, () => ({
  embeddingService: embeddingStub,
  EmbeddingService: EmbeddingServiceStub,
  applyEmbeddingTaskPrefix: (_model, text) => text,
  loadLocalTransformersBackend: async () => null,
}));
mock.module(${JSON.stringify(readyModule)}, () => ({
  ensureTursoReady: async () => {},
  resetTursoReady: () => {},
}));
mock.module(${JSON.stringify(loggerModule)}, () => ({ log: () => {} }));

const { CONFIG } = await import(${JSON.stringify(configModule)});
CONFIG.storagePath = args.storage;
CONFIG.embeddingDimensions = 4;
CONFIG.maxVectorsPerShard = Number(args.maxPerShard);

const { memoryClient } = await import(${JSON.stringify(clientModule)});

const hash = args.hash;
const label = args.label;
const writes = Number(args.writes);
const containerTag = \`opencode_project_\${hash}\`;
const errors = [];

async function writeMemories() {
  for (let i = 0; i < writes; i++) {
    const result = await memoryClient.addMemory(
      \`memory \${label} \${i}: shared-store concurrency probe\`,
      containerTag,
      { host: label === "V" ? undefined : "pi", sessionID: \`worker-\${label}\` }
    );
    if (!result.success) {
      throw new Error(\`addMemory failed: \${result.error}\`);
    }
  }
}

async function readBack() {
  const list = await memoryClient.listMemories(containerTag, 1000);
  const ids = list.success ? list.memories.map((m) => m.id) : [];
  const own = list.success
    ? list.memories.filter((m) => (m.metadata?.sessionID ?? "") === \`worker-\${label}\`).length
    : 0;
  return { totalRows: ids.length, uniqueRows: new Set(ids).size, ownRows: own };
}

let shardStructure = [];
try {
  await writeMemories();
  const read = await readBack();

  // Structure inspection via the shard manager (verifier only needs this).
  const { tursoShardManager } = await import(${JSON.stringify(shardManagerModule)});
  const shards = await tursoShardManager.getAllShards("project", hash);
  shardStructure = shards.map((s) => ({ shardIndex: s.shardIndex, vectorCount: s.vectorCount, isActive: s.isActive }));

  await memoryClient.close();
  console.log("WORKER_RESULT:" + JSON.stringify({ label, written: writes, ...read, shards: shardStructure }));
} catch (error) {
  errors.push(String(error?.stack || error));
  console.log("WORKER_RESULT:" + JSON.stringify({ label, written: writes, errors }));
  process.exitCode = 1;
}
`;

interface WorkerOutput {
  label: string;
  written: number;
  totalRows?: number;
  uniqueRows?: number;
  ownRows?: number;
  shards?: Array<{ shardIndex: number; vectorCount: number; isActive: boolean }>;
  errors?: string[];
}

function runWorker(
  scriptPath: string,
  args: Record<string, string>
): Promise<{ output: WorkerOutput | null; exitCode: number }> {
  const proc = Bun.spawn([
    "bun",
    "run",
    scriptPath,
    ...Object.entries(args).map(([key, value]) => `--${key}=${value}`),
  ]);
  const stdout = new Response(proc.stdout).text();
  return proc.exited.then(async (exitCode) => {
    const text = await stdout;
    const match = text.match(/WORKER_RESULT:(.*)$/m);
    return { output: match ? JSON.parse(match[1]) : null, exitCode };
  });
}

function writeWorkerScript(dir: string): string {
  const scriptPath = join(dir, "two-process-worker.mjs");
  writeFileSync(scriptPath, WORKER_SOURCE);
  return scriptPath;
}

async function runConcurrentScenario(options: {
  writesPerWorker: number;
  maxPerShard: number;
}): Promise<{ workers: WorkerOutput[]; verifier: WorkerOutput | null }> {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-two-process-"));
  tempDirs.push(dir);
  const storage = join(dir, "data");
  const scriptPath = writeWorkerScript(dir);
  const hash = "a1b2c3d4e5f60718";

  const workerArgs = (label: string) => ({
    storage,
    hash,
    label,
    writes: String(options.writesPerWorker),
    maxPerShard: String(options.maxPerShard),
  });

  // Both processes start together: concurrent initialisation plus
  // interleaved same-project writes through the production client.
  const [a, b] = await Promise.all([
    runWorker(scriptPath, workerArgs("A")),
    runWorker(scriptPath, workerArgs("B")),
  ]);

  // Fresh process = close/reopen verification of everything both wrote.
  const verifier = await runWorker(scriptPath, {
    storage,
    hash,
    label: "V",
    writes: "0",
    maxPerShard: String(options.maxPerShard),
  });

  return { workers: [a.output, b.output].filter(Boolean), verifier: verifier.output };
}

describe("two-process shared storage", () => {
  it("concurrent processes write one project store without losing writes", async () => {
    const { workers, verifier } = await runConcurrentScenario({
      writesPerWorker: 25,
      maxPerShard: 50000,
    });

    expect(workers.length).toBe(2);
    for (const worker of workers) {
      expect(worker.errors).toBeUndefined();
      // Read-after-write: each process observed its own writes before exiting.
      expect(worker.ownRows).toBe(25);
    }

    // Fresh process after both closed: every write survived the reopen,
    // exactly once (unique ids), nothing duplicated by the write race.
    expect(verifier?.totalRows).toBe(50);
    expect(verifier?.uniqueRows).toBe(50);
    expect(verifier?.errors).toBeUndefined();

    // Shard metadata stayed consistent: one registered shard, exact counts.
    const shards = verifier!.shards!;
    expect(shards.length).toBe(1);
    expect(shards[0].shardIndex).toBe(0);
    expect(shards[0].vectorCount).toBe(50);
    expect(shards[0].isActive).toBe(true);
  });

  it("survives repeated concurrent runs without shard duplication", async () => {
    for (let run = 0; run < 3; run++) {
      const { workers, verifier } = await runConcurrentScenario({
        writesPerWorker: 10,
        maxPerShard: 50000,
      });

      expect(workers.length).toBe(2);
      for (const worker of workers) {
        expect(worker.errors).toBeUndefined();
        expect(worker.ownRows).toBe(10);
      }
      expect(verifier?.totalRows).toBe(20);
      expect(verifier?.uniqueRows).toBe(20);
      const shardIndexes = verifier!.shards!.map((shard) => shard.shardIndex);
      expect(new Set(shardIndexes).size).toBe(shardIndexes.length);
      expect(verifier!.shards!.reduce((sum, shard) => sum + shard.vectorCount, 0)).toBe(20);
    }
  });

  it("rotates shards correctly when concurrent writes cross the shard limit", async () => {
    const { workers, verifier } = await runConcurrentScenario({
      writesPerWorker: 25,
      maxPerShard: 30,
    });

    for (const worker of workers) {
      expect(worker.errors).toBeUndefined();
      expect(worker.ownRows).toBe(25);
    }

    expect(verifier?.totalRows).toBe(50);
    expect(verifier?.uniqueRows).toBe(50);
    const shards = verifier!.shards!;
    expect(shards.length).toBe(2);
    // Exactly one shard row per index, no allocation race duplicates.
    expect(shards.map((s) => s.shardIndex).sort()).toEqual([0, 1]);
    expect(shards.reduce((sum, s) => sum + s.vectorCount, 0)).toBe(50);
    // The first shard filled to the limit and was marked read-only.
    expect(shards.find((s) => s.shardIndex === 0)?.isActive).toBe(false);
    expect(shards.find((s) => s.shardIndex === 1)?.isActive).toBe(true);
  });
});
