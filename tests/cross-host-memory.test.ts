import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const configModule = pathToFileURL(join(import.meta.dir, "../src/config.js")).href;
const embeddingModule = pathToFileURL(join(import.meta.dir, "../src/services/embedding.js")).href;
const readyModule = pathToFileURL(join(import.meta.dir, "../src/services/turso/ready.js")).href;
const loggerModule = pathToFileURL(join(import.meta.dir, "../src/services/logger.js")).href;
const clientModule = pathToFileURL(join(import.meta.dir, "../src/services/client.js")).href;
const memoryOperationsModule = pathToFileURL(
  join(import.meta.dir, "../src/core/memory-operations.js")
).href;
const piCaptureModule = pathToFileURL(join(import.meta.dir, "../src/adapters/pi/capture.js")).href;
const piRetrievalModule = pathToFileURL(
  join(import.meta.dir, "../src/adapters/pi/retrieval.js")
).href;
const coreCaptureModule = pathToFileURL(join(import.meta.dir, "../src/core/capture.js")).href;
const tagsModule = pathToFileURL(join(import.meta.dir, "../src/services/tags.js")).href;

/**
 * Cross-host integration at the engine level: real storage in a temp
 * directory, real project identity, only embeddings and the ready gate
 * stubbed. Pi capture writes must be readable through the OpenCode memory
 * operations path, and OpenCode capture writes must surface in Pi retrieval
 * — same project, same store, provenance intact.
 */

interface Harness {
  projectDir: string;
  run: (code: string) => Promise<any>;
}

function createHarness(): Harness {
  const projectDir = mkdtempSync(join(tmpdir(), "opencode-mem-cross-host-"));
  const dataDir = join(projectDir, "mem-data");
  tempDirs.push(projectDir, dataDir);

  const run = async (code: string): Promise<any> => {
    const script = `
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

const { CONFIG, initConfig } = await import(${JSON.stringify(configModule)});
CONFIG.storagePath = ${JSON.stringify(dataDir)};
CONFIG.embeddingDimensions = 4;
CONFIG.autoCaptureEnabled = true;
CONFIG.showAutoCaptureToasts = false;
CONFIG.showErrorToasts = false;
CONFIG.chatMessage.enabled = true;
CONFIG.chatMessage.excludeCurrentSession = true;

const { memoryClient } = await import(${JSON.stringify(clientModule)});
const { executeMemoryOperation } = await import(${JSON.stringify(memoryOperationsModule)});
const { capturePiSettledWorkUnit, createPiCaptureState } = await import(${JSON.stringify(piCaptureModule)});
const { buildPiRetrievalSection } = await import(${JSON.stringify(piRetrievalModule)});
const { captureConversation } = await import(${JSON.stringify(coreCaptureModule)});
const { getTags } = await import(${JSON.stringify(tagsModule)});

const projectDir = ${JSON.stringify(projectDir)};
const tags = getTags(projectDir);
let scenario;

const piEntries = [
  {
    type: "message",
    id: "pu-1",
    parentId: null,
    timestamp: "2026-01-01T10:00:00.000Z",
    message: { role: "user", content: "Decide the retry policy for the payment webhook" },
  },
  {
    type: "message",
    id: "pa-1",
    parentId: "pu-1",
    timestamp: "2026-01-01T10:00:05.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "Chose exponential backoff with jitter, five attempts, capped at thirty seconds." }] },
  },
];

const piProvider = {
  summarize: async (request) => ({
    summary: "## Request\\nDecide the webhook retry policy\\n\\n## Outcome\\nExponential backoff with jitter, five attempts, thirty second cap in webhook-retry.ts.",
    type: "technical-decision",
    tags: ["webhook", "retry"],
  }),
};

const opencodeProvider = {
  summarize: async (request) => ({
    summary: "## Request\\nPick the store concurrency model\\n\\n## Outcome\\nPer-scope write locks chosen for the shared store in store-locking.ts.",
    type: "technical-decision",
    tags: ["storage", "concurrency"],
  }),
};

${code}

await memoryClient.close();
console.log("RESULT:" + JSON.stringify(typeof scenario !== "undefined" ? scenario : null));
`;

    const dir = mkdtempSync(join(tmpdir(), "opencode-mem-cross-host-run-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "scenario.mjs");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(scriptPath, script);
    const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: dir });
    const stdout = proc.stdout.toString();
    const match = stdout.match(/RESULT:(.*)$/m);
    if (!match) {
      throw new Error(`scenario produced no result: ${stdout}\n${proc.stderr.toString()}`);
    }
    return JSON.parse(match[1]);
  };

  return { projectDir, run };
}

describe("cross-host memory sharing (Pi <-> OpenCode)", () => {
  it("Pi-captured memory is retrievable through OpenCode memory operations", async () => {
    const { run } = createHarness();
    const scenario = await run(`
const capture = await capturePiSettledWorkUnit({
  sessionId: "pi-session-1",
  directory: projectDir,
  entries: piEntries,
  provider: piProvider,
  state: createPiCaptureState(),
});

const search = await executeMemoryOperation(
  { mode: "search", query: "webhook retry policy" },
  { directory: projectDir, host: "opencode" }
);

const list = await memoryClient.listMemories(tags.project.tag, 10);
const stored = list.memories.find((m) => m.id === capture.memoryId);

scenario = { capture, search, stored: stored ? { metadata: stored.metadata } : null, tagsTag: tags.project.tag };
`);

    expect(scenario.capture.status).toBe("captured");
    // OpenCode-side search finds the Pi-written memory.
    expect(scenario.search.success).toBe(true);
    expect(scenario.search.results.some((r: any) => r.id === scenario.capture.memoryId)).toBe(true);
    // Same project namespace, Pi provenance preserved.
    expect(scenario.tagsTag).toMatch(/^opencode_project_/);
    expect(scenario.stored.metadata.host).toBe("pi");
    expect(scenario.stored.metadata.sourceType).toBe("live-capture");
    expect(scenario.stored.metadata.hostSessionId).toBe("pi-session-1");
  });

  it("OpenCode-captured memory surfaces in Pi before_agent_start retrieval", async () => {
    const { run } = createHarness();
    const scenario = await run(`
const capture = await captureConversation(
  {
    host: "opencode",
    hostSessionId: "oc-session-9",
    sourceType: "live-capture",
    projectDirectory: projectDir,
    userPrompt: "Pick the store concurrency model",
    textResponses: ["Per-scope write locks chosen for the shared store."],
    toolCalls: [],
  },
  opencodeProvider
);

const section = await buildPiRetrievalSection("how is the store locked?", projectDir, "pi-session-2");

scenario = { capture, section };
`);

    expect(scenario.capture.status).toBe("captured");
    expect(scenario.section).toContain("store-locking.ts");
  });

  it("both hosts write to the same project namespace with distinct provenance", async () => {
    const { run } = createHarness();
    const scenario = await run(`
const piCapture = await capturePiSettledWorkUnit({
  sessionId: "pi-session-1",
  directory: projectDir,
  entries: piEntries,
  provider: piProvider,
  state: createPiCaptureState(),
});

const ocCapture = await captureConversation(
  {
    host: "opencode",
    hostSessionId: "oc-session-9",
    sourceType: "live-capture",
    projectDirectory: projectDir,
    userPrompt: "Pick the store concurrency model",
    textResponses: ["Per-scope write locks chosen."],
    toolCalls: [],
  },
  opencodeProvider
);

const list = await memoryClient.listMemories(tags.project.tag, 10);
const piMemory = list.memories.find((m) => m.id === piCapture.memoryId);
const ocMemory = list.memories.find((m) => m.id === ocCapture.memoryId);

// Namespace proof straight from the shard rows.
const { tursoShardManager } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/turso/shard-manager.js")).href)});
const { tursoConnectionManager } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/turso/connection-manager.js")).href)});
const shards = await tursoShardManager.getAllShards("project", tags.project.tag.replace(/^opencode_project_/, ""));
const db = await tursoConnectionManager.getConnection(shards[0].dbPath);
const piRow = await db.get("SELECT container_tag FROM memories WHERE id = ?", [piCapture.memoryId]);
const ocRow = await db.get("SELECT container_tag FROM memories WHERE id = ?", [ocCapture.memoryId]);

scenario = {
  pi: piMemory ? { host: piMemory.metadata.host } : null,
  oc: ocMemory ? { host: ocMemory.metadata.host } : null,
  piTag: piRow ? piRow.container_tag : null,
  ocTag: ocRow ? ocRow.container_tag : null,
  sameTag: piRow && ocRow ? piRow.container_tag === ocRow.container_tag : false,
};
`);

    expect(scenario.pi.host).toBe("pi");
    expect(scenario.oc.host).toBe("opencode");
    expect(scenario.piTag).toMatch(/^opencode_project_/);
    expect(scenario.sameTag).toBe(true);
  });

  it("Pi retrieval excludes memories captured in the current Pi session", async () => {
    const { run } = createHarness();
    const scenario = await run(`
const capture = await capturePiSettledWorkUnit({
  sessionId: "pi-session-5",
  directory: projectDir,
  entries: piEntries,
  provider: piProvider,
  state: createPiCaptureState(),
});

const ownSessionSection = await buildPiRetrievalSection("webhook retry", projectDir, "pi-session-5");
const otherSessionSection = await buildPiRetrievalSection("webhook retry", projectDir, "pi-session-6");

scenario = { ownSessionSection, otherSessionSection };
`);

    expect(scenario.otherSessionSection).toContain("webhook-retry.ts");
    expect(scenario.ownSessionSection).toBeNull();
  });
});
