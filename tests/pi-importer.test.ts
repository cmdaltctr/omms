import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SKIP_ON_SLOW_WINDOWS } from "./test-process.js";

// Each scenario spawns a fresh Bun process and runs several imports against a
// real database. Windows runners take over 5 s (Bun's default) for the
// multi-import scenarios, so the test is killed before it reports a result.
setDefaultTimeout(30_000);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const configUrl = pathToFileURL(join(import.meta.dir, "../src/config.js")).href;
const clientUrl = pathToFileURL(join(import.meta.dir, "../src/services/client.js")).href;
const embeddingUrl = pathToFileURL(join(import.meta.dir, "../src/services/embedding.js")).href;
const readyUrl = pathToFileURL(join(import.meta.dir, "../src/services/turso/ready.js")).href;
const loggerUrl = pathToFileURL(join(import.meta.dir, "../src/services/logger.js")).href;
const importerUrl = pathToFileURL(join(import.meta.dir, "../src/importer/importer.js")).href;
const loaderUrl = pathToFileURL(join(import.meta.dir, "../src/importer/session-loader.js")).href;
const ledgerUrl = pathToFileURL(join(import.meta.dir, "../src/importer/ledger.js")).href;
const fixturesUrl = pathToFileURL(join(import.meta.dir, "./pi-import-fixtures.js")).href;
const jobsUrl = pathToFileURL(join(import.meta.dir, "../src/importer/web-import-jobs.js")).href;
const sourcesUrl = pathToFileURL(join(import.meta.dir, "../src/importer/import-sources.js")).href;
const sessionsUrl = pathToFileURL(join(import.meta.dir, "../src/importer/import-sessions.js")).href;
const runImportUrl = pathToFileURL(join(import.meta.dir, "../src/importer/run-import.js")).href;
const modelSelectionUrl = pathToFileURL(
  join(import.meta.dir, "../src/importer/model-selection.js")
).href;

/**
 * Engine-level importer tests: real storage (temp libSQL), real project
 * identity, real Pi SessionManager loading of fixture session files. Only the
 * embedding service, the ready gate, and the logger are stubbed; the provider
 * is a scripted stub.
 */
function runScenario(body: string): any {
  const base = mkdtempSync(join(tmpdir(), "pi-importer-"));
  tempDirs.push(base);
  const scriptPath = join(base, "scenario.mjs");

  const script = `
import { mock } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

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
mock.module(${JSON.stringify(embeddingUrl)}, () => ({
  embeddingService: embeddingStub,
  EmbeddingService: EmbeddingServiceStub,
  applyEmbeddingTaskPrefix: (_model, text) => text,
  loadLocalTransformersBackend: async () => null,
}));
mock.module(${JSON.stringify(readyUrl)}, () => ({
  ensureTursoReady: async () => {},
  resetTursoReady: () => {},
}));
const attemptRecords = [];
mock.module(${JSON.stringify(loggerUrl)}, () => ({
  log: (message, data) => {
    if (message === "Capture attempt") attemptRecords.push(data);
  },
}));

const { CONFIG } = await import(${JSON.stringify(configUrl)});
const base = ${JSON.stringify(base)};
const storage = base + "/data";
CONFIG.storagePath = storage;
CONFIG.embeddingDimensions = 4;
CONFIG.autoCaptureMaxContextBytes = 131072;
CONFIG.autoCaptureEnabled = true;

const { memoryClient } = await import(${JSON.stringify(clientUrl)});
const { importPiHistory } = await import(${JSON.stringify(importerUrl)});
const { loadPiSessionForImport } = await import(${JSON.stringify(loaderUrl)});
const { PiImportLedger, importLedgerDbPath } = await import(${JSON.stringify(ledgerUrl)});
const { writeV3Session, writeLegacyV1Session, writeNonSessionArtifact, makeProjectDir } = await import(${JSON.stringify(fixturesUrl)});
CONFIG.injectProfile = false;
CONFIG.chatMessage = { enabled: true, maxMemories: 10, excludeCurrentSession: true, injectOn: "first" };

const sessionRoot = base + "/sessions";
const projectA = makeProjectDir(base, "project-a");
const projectB = makeProjectDir(base, "project-b");

const providerCalls = [];
const failPrompts = new Set();
const provider = {
  summarize: async (request) => {
    providerCalls.push(request.userPrompt);
    if (failPrompts.has(request.userPrompt)) {
      throw new Error("extraction exploded");
    }
    if (request.userPrompt.includes("SKIPME")) {
      return { summary: "", type: "skip", tags: [] };
    }
    return {
      summary: "## Request\\n" + request.userPrompt + "\\n\\n## Outcome\\nImported fixture outcome.",
      type: "technical-decision",
      tags: ["import-fixture"],
    };
  },
};

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function jsonlFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
      const full = dir + "/" + entry.name;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsonl")) out.push(full);
    }
  };
  if (existsSync(sessionRoot)) walk(sessionRoot);
  return out.sort();
}

async function storedMemories() {
  const list = await memoryClient.listMemories(null, 1000, "all-projects");
  return list.success ? list.memories : [];
}

async function ledgerRows() {
  const { tursoConnectionManager } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/turso/connection-manager.js")).href)});
  const db = await tursoConnectionManager.getConnection(importLedgerDbPath());
  return db.all("SELECT * FROM import_ledger ORDER BY key");
}

let scenario;

${body}

await memoryClient.close();
console.log("RESULT:" + JSON.stringify(typeof scenario !== "undefined" ? scenario : null));
`;

  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: base });
  const stdout = proc.stdout.toString();
  const match = stdout.match(/RESULT:(.*)$/m);
  if (!match) {
    throw new Error(`scenario produced no result: ${stdout}\n${proc.stderr.toString()}`);
  }
  return JSON.parse(match[1]);
}

const DEFAULT_FILTERS = {
  scope: "all-projects",
  currentDirectory: "/nonexistent",
};

// Extra harness imports for the cross-host retrieval scenario.
const memoryOpsUrl = pathToFileURL(join(import.meta.dir, "../src/core/memory-operations.js")).href;
const retrievalUrl = pathToFileURL(join(import.meta.dir, "../src/core/retrieval.js")).href;

describe("Pi historical importer", () => {
  it("skips live-captured exchanges in dry and real imports", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot + "/proj-a", { recursive: true });
const file = sessionRoot + "/proj-a/live.jsonl";
const windows = [
  { userText: "First request", assistantText: "First reply", timestamp: "2026-01-01T10:00:00.000Z" },
  { userText: "Second request", assistantText: "Second reply", timestamp: "2026-01-02T10:00:00.000Z" },
  { userText: "Third request", assistantText: "Third reply", timestamp: "2026-01-03T10:00:00.000Z" },
];
writeV3Session({ file, sessionId: "sess-live", cwd: projectA, windows: windows.slice(0, 1) });
await importPiHistory({ loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot });
const { tursoConnectionManager } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/turso/connection-manager.js")).href)});
const { tursoShardManager } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/turso/shard-manager.js")).href)});
const { getTags } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/tags.js")).href)});
const { extractScopeFromContainerTag } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/memory-scope.js")).href)});
const hash = extractScopeFromContainerTag(getTags(projectA).project.tag).hash;
for (const shard of await tursoShardManager.getAllShards("project", hash)) {
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  await db.run("UPDATE memories SET metadata = json_remove(json_set(metadata, '$.sourceType', 'live-capture'), '$.importId')");
}
await (await tursoConnectionManager.getConnection(importLedgerDbPath())).run("DELETE FROM import_ledger");
writeV3Session({ file, sessionId: "sess-live", cwd: projectA, windows });
const dry = await importPiHistory({ loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot, dryRun: true });
const dryRows = await ledgerRows();
const real = await importPiHistory({ loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot });
scenario = { dry: { skipped: dry.unitsSkipped, wouldImport: dry.unitsWouldImport },
  real: { skipped: real.unitsSkipped, imported: real.unitsImported, reasons: real.skipReasons },
  rows: await ledgerRows(), dryRows, calls: providerCalls.length };
    `);
    expect(out.dry).toEqual({ skipped: 1, wouldImport: 2 });
    expect(out.dryRows).toEqual([]);
    expect(out.real).toMatchObject({ skipped: 1, imported: 2, reasons: { "live-captured": 1 } });
    expect(
      out.rows.some((row: any) => row.status === "skipped" && row.skip_reason === "live-captured")
    ).toBe(true);
    expect(out.calls).toBe(3);
  });
  it("skips a later turn saved live after the import began", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot + "/proj-a", { recursive: true });
writeV3Session({ file: sessionRoot + "/proj-a/race.jsonl", sessionId: "sess-race", cwd: projectA,
  windows: [
    { userText: "First request", assistantText: "First reply" },
    { userText: "Second request", assistantText: "Second reply" },
    { userText: "Third request", assistantText: "Third reply" },
  ],
});
const { tursoConnectionManager } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/turso/connection-manager.js")).href)});
const { tursoShardManager } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/turso/shard-manager.js")).href)});
const { getTags } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/tags.js")).href)});
const { extractScopeFromContainerTag } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/memory-scope.js")).href)});
const hash = extractScopeFromContainerTag(getTags(projectA).project.tag).hash;
const raceProvider = { summarize: async (request) => {
  providerCalls.push(request.userPrompt);
  if (request.userPrompt === "First request") {
    const shard = await tursoShardManager.createShard("project", hash, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    await db.run("INSERT INTO memories (id, content, vector, container_tag, created_at, updated_at, metadata) VALUES (?, ?, vector32(?), ?, ?, ?, ?)",
      ["new-live", "Saved during import", JSON.stringify(Array(CONFIG.embeddingDimensions).fill(0)),
        hash, 1, 1, JSON.stringify({ host: "pi", hostSessionId: "sess-race",
          sourceType: "live-capture", promptId: "f0000002", sourceEntryIds: ["f0000003"] })]);
  }
  return { summary: "## Request\\n" + request.userPrompt + "\\n\\n## Outcome\\nDone.",
    type: "technical-decision", tags: ["import-fixture"] };
} };
const report = await importPiHistory({ loadSession: loadPiSessionForImport, provider: raceProvider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot });
scenario = { skipped: report.unitsSkipped, imported: report.unitsImported,
  reasons: report.skipReasons, calls: providerCalls };
    `);
    expect(out).toEqual({
      skipped: 1,
      imported: 2,
      reasons: { "live-captured": 1 },
      calls: ["First request", "Third request"],
    });
  });

  it("writes a history-import diagnostics record for each import attempt", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot + "/proj-a", { recursive: true });
writeV3Session({
  file: sessionRoot + "/proj-a/s1.jsonl",
  sessionId: "sess-diag",
  cwd: projectA,
  windows: [
    { userText: "Add retry to uploader", assistantText: "Added retry", timestamp: "2026-01-01T10:00:00.000Z" },
    { userText: "SKIPME greeting", assistantText: "hello", timestamp: "2026-01-02T10:00:00.000Z" },
  ],
});
await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);
scenario = attemptRecords.map((r) => ({ sourceType: r.sourceType, host: r.host, outcome: r.outcome }));
`);

    expect(out).toEqual([
      { sourceType: "history-import", host: "pi", outcome: "saved" },
      { sourceType: "history-import", host: "pi", outcome: "skipped" },
    ]);
  });

  it("cancels after a work unit and imports only the remaining unit on rerun", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot + "/proj-a", { recursive: true });
writeV3Session({
  file: sessionRoot + "/proj-a/cancel.jsonl",
  sessionId: "sess-cancel", cwd: projectA,
  windows: [
    { userText: "First memory", assistantText: "first done", timestamp: "2026-01-01T10:00:00.000Z" },
    { userText: "Second memory", assistantText: "second done", timestamp: "2026-01-02T10:00:00.000Z" },
  ],
});
const controller = new AbortController();
const cancellingProvider = { summarize: async (request) => {
  const result = await provider.summarize(request);
  controller.abort();
  return result;
} };
const first = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider: cancellingProvider, signal: controller.signal },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);
const second = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);
scenario = { first: first.unitsImported, second: second.unitsImported,
  already: second.unitsAlreadyHandled, calls: providerCalls.length };
`);
    expect(out).toEqual({ first: 1, second: 1, already: 1, calls: 2 });
  });

  it("dry-run reports candidates and writes nothing", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot + "/proj-a", { recursive: true });
const { writeFileSync: wfs } = await import("node:fs");
const s1 = sessionRoot + "/proj-a/s1.jsonl";
writeV3Session({
  file: s1,
  sessionId: "sess-1",
  cwd: projectA,
  windows: [
    {
      userText: "Add retry to uploader",
      assistantText: "Added retry with backoff",
      toolCall: { name: "bash", args: { command: "bun test tests/uploader.test.ts" } },
      timestamp: "2026-01-01T10:00:00.000Z",
    },
    { userText: "SKIPME greeting", assistantText: "hello", timestamp: "2026-01-02T10:00:00.000Z" },
  ],
});
// Append a compaction entry at the branch tail: the walk must tolerate
// non-message entries on the branch (in-window compaction is covered by the
// conversation unit tests).
wfs(s1, JSON.stringify({ type: "compaction", id: "c0mpact1", parentId: "f0000003", timestamp: "2026-01-02T11:00:00.000Z", summary: "summarised earlier work", tokensBefore: 1000 }) + String.fromCharCode(10), { flag: "a" });
writeV3Session({
  file: sessionRoot + "/proj-a/s2.jsonl",
  sessionId: "sess-1b",
  cwd: projectA,
  windows: [
    { userText: "Post-compaction work", assistantText: "continued fine", timestamp: "2026-01-03T10:00:00.000Z" },
  ],
});
writeNonSessionArtifact(sessionRoot + "/proj-a/artifact.jsonl");

const report = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, dryRun: true, root: sessionRoot }
);

scenario = {
  report,
  memoryCount: (await storedMemories()).length,
  ledgerExists: existsSync(importLedgerDbPath()),
};
`);

    expect(out.report.dryRun).toBe(true);
    expect(out.report.sessionsDiscovered).toBe(2);
    expect(out.report.sessionsUnrecognized).toBe(1);
    expect(out.report.sessionsLoaded).toBe(2);
    expect(out.report.unitsTotal).toBe(3);
    expect(out.report.unitsWouldImport).toBe(3);
    expect(out.report.projects.length).toBe(1);
    expect(out.report.projects[0].tag).toMatch(/^omms_project_/);
    expect(out.report.projects[0].sessions).toBe(2);
    expect(out.memoryCount).toBe(0);
    expect(out.ledgerExists).toBe(false);
  });

  it("imports with full provenance, keeps sources untouched, and reruns with zero duplicates", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot + "/a", { recursive: true });
writeV3Session({
  file: sessionRoot + "/a/s1.jsonl",
  sessionId: "sess-import-1",
  cwd: projectA,
  windows: [
    { userText: "Add retry to uploader", assistantText: "Added backoff", timestamp: "2026-01-01T10:00:00.000Z" },
  ],
});
writeV3Session({
  file: sessionRoot + "/a/s2.jsonl",
  sessionId: "sess-import-2",
  cwd: projectA,
  windows: [
    { userText: "SKIPME casual chat", assistantText: "hi", timestamp: "2026-01-05T10:00:00.000Z" },
  ],
});

const hashesBefore = {};
for (const file of jsonlFiles()) hashesBefore[file] = hashFile(file);

const first = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);
const firstProviderCalls = providerCalls.length;

const second = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);

const memories = await storedMemories();
const rows = await ledgerRows();
const hashesAfter = {};
for (const file of jsonlFiles()) hashesAfter[file] = hashFile(file);

scenario = {
  first, second, memories, rows: rows.map(r => ({ key: r.key, status: r.status, memory_id: r.memory_id, skip_reason: r.skip_reason })),
  firstProviderCalls,
  secondProviderCalls: providerCalls.length - firstProviderCalls,
  sourcesUnchanged: JSON.stringify(hashesBefore) === JSON.stringify(hashesAfter),
};
`);

    // First run: one imported, one extractor skip, both terminal.
    expect(out.first.unitsImported).toBe(1);
    expect(out.first.unitsSkipped).toBe(1);
    expect(out.first.unitsFailed).toBe(0);
    expect(out.firstProviderCalls).toBe(2);

    // Provenance on the imported memory.
    const imported = out.memories[0];
    expect(imported.metadata.host).toBe("pi");
    expect(imported.metadata.sourceType).toBe("history-import");
    expect(imported.metadata.hostSessionId).toBe("sess-import-1");
    expect(imported.metadata.importId).toBe(
      "pi:sess-import-1:" +
        out.memories[0].metadata.importId.split(":")[2] +
        ":" +
        out.memories[0].metadata.importId.split(":")[3]
    );
    expect(imported.metadata.importId.startsWith("pi:sess-import-1:")).toBe(true);
    expect(imported.metadata.sourceFile).toContain("s1.jsonl");

    // Ledger: both terminal.
    const statuses = out.rows.map((r: any) => r.status).sort();
    expect(statuses).toEqual(["imported", "skipped"]);
    expect(out.rows.find((r: any) => r.status === "skipped").skip_reason).toContain(
      "extractor-skip"
    );

    // Second run: nothing reprocessed, no new model calls, no new memories.
    expect(out.second.unitsAlreadyHandled).toBe(2);
    expect(out.second.unitsImported).toBe(0);
    expect(out.second.unitsSkipped).toBe(0);
    expect(out.second.unitsFailed).toBe(0);
    expect(out.secondProviderCalls).toBe(0);
    expect(out.memories.length).toBe(1);

    // Source files byte-for-byte unchanged.
    expect(out.sourcesUnchanged).toBe(true);
  });

  it("reconciles a crash between memory insert and ledger commit", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
writeV3Session({
  file: sessionRoot + "/s1.jsonl",
  sessionId: "sess-crash",
  cwd: projectA,
  windows: [
    { userText: "Decide WAL for queue", assistantText: "Chose WAL", timestamp: "2026-01-01T10:00:00.000Z" },
  ],
});

await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);

// Simulate the crash window: memory exists, ledger never committed.
const { tursoConnectionManager } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/services/turso/connection-manager.js")).href)});
const db = await tursoConnectionManager.getConnection(importLedgerDbPath());
await db.run("UPDATE import_ledger SET status = 'in-progress', memory_id = NULL");

const callsBefore = providerCalls.length;
const rerun = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);

scenario = { rerun, memoryCount: (await storedMemories()).length, modelCalls: providerCalls.length - callsBefore };
`);

    expect(out.rerun.unitsAlreadyHandled).toBe(1);
    expect(out.rerun.unitsImported).toBe(0);
    expect(out.modelCalls).toBe(0);
    expect(out.memoryCount).toBe(1);
  });

  it("keeps failed units retryable and imports them on the next run", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
writeV3Session({
  file: sessionRoot + "/s1.jsonl",
  sessionId: "sess-fail",
  cwd: projectA,
  windows: [
    { userText: "Unstable prompt", assistantText: "work", timestamp: "2026-01-01T10:00:00.000Z" },
    { userText: "Stable prompt", assistantText: "stable work", timestamp: "2026-01-02T10:00:00.000Z" },
  ],
});

failPrompts.add("Unstable prompt");

const first = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);

// The provider now works for the failed unit; it should import on rerun.
failPrompts.clear();
const second = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);

scenario = { first, second, memoryCount: (await storedMemories()).length };
`);

    expect(out.first.unitsFailed).toBe(1);
    expect(out.first.unitsImported).toBe(1);
    expect(out.second.unitsImported).toBe(1);
    expect(out.second.unitsFailed).toBe(0);
    expect(out.memoryCount).toBe(2);
  });

  it.skipIf(SKIP_ON_SLOW_WINDOWS)(
    "applies session, date, and scope filters before expensive work",
    () => {
      const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot + "/x", { recursive: true });
writeV3Session({
  file: sessionRoot + "/x/target.jsonl",
  sessionId: "sess-target",
  cwd: projectA,
  windows: [
    { userText: "Old work", assistantText: "old", timestamp: "2026-01-01T10:00:00.000Z" },
    { userText: "New work", assistantText: "new", timestamp: "2026-03-01T10:00:00.000Z" },
  ],
});
writeV3Session({
  file: sessionRoot + "/x/other.jsonl",
  sessionId: "sess-other",
  cwd: projectB,
  windows: [
    { userText: "Other project work", assistantText: "other", timestamp: "2026-02-01T10:00:00.000Z" },
  ],
});

const sessionFilter = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot, session: "sess-target" }
);
const dateFilter = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot, session: "sess-target", since: Date.parse("2026-02-01T00:00:00Z") }
);
const projectFilter = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { scope: "current-project", currentDirectory: projectB, root: sessionRoot }
);

scenario = {
  sessionFilter: { discovered: sessionFilter.sessionsLoaded, units: sessionFilter.unitsTotal },
  dateFilter: { units: dateFilter.unitsTotal, preview: dateFilter.units[0]?.promptPreview },
  projectFilter: { loaded: projectFilter.sessionsLoaded, filtered: projectFilter.sessionsFilteredOut, tags: projectFilter.projects.map(p => p.directory) },
};
`);

      expect(out.sessionFilter.discovered).toBe(1);
      expect(out.sessionFilter.units).toBe(2);
      expect(out.dateFilter.units).toBe(1);
      expect(out.dateFilter.preview).toContain("New work");
      expect(out.projectFilter.loaded).toBe(1);
      expect(out.projectFilter.filtered).toBe(1);
      expect(out.projectFilter.tags).toEqual([out.projectFilter.tags[0]]);
    }
  );

  it("skips unresolvable cwds by default and imports them with --map", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
writeV3Session({
  file: sessionRoot + "/gone.jsonl",
  sessionId: "sess-gone",
  cwd: base + "/deleted-worktree",
  windows: [
    { userText: "Worktree decision", assistantText: "decided", timestamp: "2026-01-01T10:00:00.000Z" },
  ],
});

const withoutMap = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);

const withMap = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot,
    pathMaps: [{ from: base + "/deleted-worktree", to: projectA }] }
);

const memories = await storedMemories();

scenario = {
  withoutMap: { unresolvable: withoutMap.unresolvableSessions, loaded: withoutMap.sessionsLoaded, units: withoutMap.unitsTotal },
  withMap: { loaded: withMap.sessionsLoaded, imported: withMap.unitsImported, tags: withMap.projects.map(p => p.directory) },
  memories,
};
`);

    expect(out.withoutMap.unresolvable.length).toBe(1);
    expect(out.withoutMap.unresolvable[0].cwd).toContain("deleted-worktree");
    expect(out.withoutMap.units).toBe(0);
    expect(out.withMap.loaded).toBe(1);
    expect(out.withMap.imported).toBe(1);
    expect(out.withMap.tags.length).toBe(1);
    expect(out.withMap.tags[0].endsWith("project-a")).toBe(true);
    expect(out.memories[0].metadata.hostSessionId).toBe("sess-gone");
  });

  it("imports legacy version 1 sessions through Pi's migration", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
writeLegacyV1Session({
  file: sessionRoot + "/legacy.jsonl",
  sessionId: "sess-legacy",
  cwd: projectA,
  windows: [
    { userText: "Legacy decision", assistantText: "legacy outcome", timestamp: "2025-06-01T10:00:00.000Z" },
  ],
});

const report = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);

scenario = { report, memories: await storedMemories() };
`);

    expect(out.report.unitsImported).toBe(1);
    expect(out.report.sessionsLoaded).toBe(1);
    expect(out.memories[0].metadata.importId.startsWith("pi:sess-legacy:")).toBe(true);
    expect(out.memories[0].summary).toContain("Legacy decision");
  });

  it("makes imported history retrievable from both hosts", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
writeV3Session({
  file: sessionRoot + "/shared.jsonl",
  sessionId: "sess-shared",
  cwd: projectA,
  windows: [
    { userText: "Adopt usearch for the vector index", assistantText: "Adopted usearch with hnsw params", timestamp: "2026-01-01T10:00:00.000Z" },
  ],
});

const report = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);

// OpenCode side: shared memory operations search.
const { executeMemoryOperation } = await import(${JSON.stringify(memoryOpsUrl)});
const opencodeSearch = await executeMemoryOperation(
  { mode: "search", query: "usearch vector index" },
  { directory: projectA, host: "opencode" }
);

// Pi side: before_agent_start retrieval over the same store.
const { buildRetrievalSection } = await import(${JSON.stringify(retrievalUrl)});
const piSection = await buildRetrievalSection("usearch vector index", projectA, "pi-live-session");

scenario = {
  imported: report.unitsImported,
  opencodeCount: opencodeSearch.count,
  opencodeIds: opencodeSearch.results.map((r) => r.id),
  piSection,
};
`);

    expect(out.imported).toBe(1);
    // OpenCode memory operations find the imported memory.
    expect(out.opencodeCount).toBeGreaterThanOrEqual(1);
    // Pi retrieval surfaces the same content from the same store.
    expect(out.piSection).toContain("usearch");
  });

  it("isolates load failures per session and continues", () => {
    const out = runScenario(`
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
writeV3Session({
  file: sessionRoot + "/good.jsonl",
  sessionId: "sess-good",
  cwd: projectA,
  windows: [
    { userText: "Good work", assistantText: "done", timestamp: "2026-01-01T10:00:00.000Z" },
  ],
});
// session-format header, but the loader will throw for this file via stub
writeV3Session({
  file: sessionRoot + "/bad.jsonl",
  sessionId: "sess-bad",
  cwd: projectA,
  windows: [
    { userText: "Bad work", assistantText: "boom", timestamp: "2026-01-01T10:00:00.000Z" },
  ],
});

const failingLoader = (file) => {
  if (file.endsWith("bad.jsonl")) throw new Error("synthetic load failure");
  return loadPiSessionForImport(file);
};

const report = await importPiHistory(
  { loadSession: failingLoader, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot }
);

scenario = { report };
`);

    expect(out.report.loadErrors.length).toBe(1);
    expect(out.report.loadErrors[0].error).toContain("synthetic load failure");
    expect(out.report.sessionsLoaded).toBe(1);
    expect(out.report.unitsImported).toBe(1);
  });

  it("reuses the CLI ledger from a page import", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
writeV3Session({
  file: sessionRoot + "/already.jsonl", sessionId: "sess-already", cwd: projectA,
  windows: [{ userText: "Already imported", assistantText: "done" }],
});
const cli = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot, skipProfile: true }
);
mock.module(${JSON.stringify(modelSelectionUrl)}, () => ({
  selectImportModel: () => ({ capture: provider, profile: { provider: "test", modelId: "test", complete: async () => "{}" } }),
}));
const { SettingsImportJobs } = await import(${JSON.stringify(jobsUrl)});
const { validateImportSource } = await import(${JSON.stringify(sourcesUrl)});
const { listImportSessions } = await import(${JSON.stringify(sessionsUrl)});
const source = validateImportSource("pi", sessionRoot);
const list = await listImportSessions(
  { sourceToken: source.sourceToken, refresh: true },
  { host: "pi", scope: "all-projects", pathMaps: [], cwd: projectA }
);
const jobs = new SettingsImportJobs({
  readiness: async () => ({
    external: { state: "ready", provider: "openai-chat", model: "m" },
    opencode: { available: false, models: [] },
    piReader: { available: true },
  }),
});
await jobs.start({
  host: "pi",
  source: source.sourceToken,
  selection: { mode: "all", excludedKeys: [], revision: list.revision, listedAt: list.listedAt },
  options: { scope: "all-projects", skipProfile: true },
  modelChoice: "external",
}, projectA);
for (let i = 0; i < 100 && jobs.current()?.state === "running"; i++) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
scenario = { cli: cli.unitsImported, page: jobs.current() };
`);
    expect(out.cli).toBe(1);
    expect(out.page.state).toBe("done");
    expect(out.page.summary.unitsAlreadyHandled).toBe(1);
    expect(out.page.summary.unitsImported).toBe(0);
  });

  it("keeps the full unresolved list when one project's sessions are listed later", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
writeV3Session({
  file: sessionRoot + "/here.jsonl", sessionId: "sess-here", cwd: projectA,
  windows: [{ userText: "Work here", assistantText: "ok" }],
});
writeV3Session({
  file: sessionRoot + "/gone.jsonl", sessionId: "sess-gone", cwd: base + "/deleted-worktree",
  windows: [{ userText: "Work in a deleted worktree", assistantText: "ok" }],
});
const { validateImportSource } = await import(${JSON.stringify(sourcesUrl)});
const { listImportSessions } = await import(${JSON.stringify(sessionsUrl)});
const { readUnresolvedDirectories } = await import(${JSON.stringify(
      pathToFileURL(join(import.meta.dir, "../src/services/backfill-state.js")).href
    )});
const source = validateImportSource("pi", sessionRoot);
await listImportSessions(
  { sourceToken: source.sourceToken, refresh: true },
  { host: "pi", scope: "all-projects", pathMaps: [], cwd: projectA }
);
const afterAll = await readUnresolvedDirectories("pi");
await listImportSessions(
  { sourceToken: source.sourceToken, refresh: true },
  { host: "pi", scope: "current-project", project: projectA, pathMaps: [], cwd: projectA }
);
scenario = { afterAll, afterProject: await readUnresolvedDirectories("pi"), base };
`);
    expect(out.afterAll).toEqual([{ directory: out.base + "/deleted-worktree", sessions: 1 }]);
    expect(out.afterProject).toEqual(out.afterAll);
  });

  it("imports exactly one file when the root is a .jsonl file", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
writeV3Session({
  file: sessionRoot + "/one.jsonl", sessionId: "sess-one", cwd: projectA,
  windows: [{ userText: "Only this file", assistantText: "ok" }],
});
writeV3Session({
  file: sessionRoot + "/two.jsonl", sessionId: "sess-two", cwd: projectA,
  windows: [{ userText: "Not this file", assistantText: "no" }],
});
const report = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot + "/one.jsonl", dryRun: true }
);
scenario = { discovered: report.sessionsDiscovered, previews: report.units.map((u) => u.promptPreview) };
`);
    expect(out.discovered).toBe(1);
    expect(out.previews).toEqual(["Only this file"]);
  });

  it("reports a file whose loaded session ID differs from its header as a load error", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
writeV3Session({
  file: sessionRoot + "/a.jsonl", sessionId: "sess-a", cwd: projectA,
  windows: [{ userText: "Mismatched", assistantText: "x" }],
});
const report = await importPiHistory(
  { loadSession: (file) => ({ ...loadPiSessionForImport(file), sessionId: "other" }), provider },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot, dryRun: true }
);
scenario = { errors: report.loadErrors.map((e) => e.error), units: report.unitsTotal };
`);
    expect(out.errors).toEqual(["Loaded session ID does not match the file header"]);
    expect(out.units).toBe(0);
  });

  it("imports only selected keys, holds back newer turns, and imports them on a later run", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot + "/p", { recursive: true });
writeV3Session({
  file: sessionRoot + "/p/picked.jsonl", sessionId: "sess-picked", cwd: projectA,
  windows: [
    { userText: "Before listing", assistantText: "a", timestamp: "2026-01-01T10:00:00.000Z" },
    { userText: "After listing", assistantText: "b", timestamp: "2026-01-03T10:00:00.000Z" },
  ],
});
writeV3Session({
  file: sessionRoot + "/p/skipped.jsonl", sessionId: "sess-skipped", cwd: projectA,
  windows: [{ userText: "Not selected", assistantText: "c", timestamp: "2026-01-01T11:00:00.000Z" }],
});
const cutoff = Date.parse("2026-01-02T00:00:00Z");
const filters = { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot, skipProfile: true };
const preview = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...filters, dryRun: true, selectionKeys: ["p/picked.jsonl"], cutoff }
);
const first = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...filters, selectionKeys: ["p/picked.jsonl"], cutoff }
);
const callsAfterFirst = [...providerCalls];
const second = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider },
  { ...filters, selectionKeys: ["p/picked.jsonl"], cutoff: Date.now() }
);
scenario = {
  preview: { units: preview.unitsTotal, heldBack: preview.unitsHeldBack, filtered: preview.sessionsFilteredOut },
  first: { imported: first.unitsImported, heldBack: first.unitsHeldBack },
  callsAfterFirst,
  second: { imported: second.unitsImported, already: second.unitsAlreadyHandled, heldBack: second.unitsHeldBack },
};
`);
    expect(out.preview).toEqual({ units: 1, heldBack: 1, filtered: 1 });
    expect(out.first).toEqual({ imported: 1, heldBack: 1 });
    expect(out.callsAfterFirst).toEqual(["Before listing"]);
    expect(out.second).toEqual({ imported: 1, already: 1, heldBack: 0 });
  });

  it("stops loading sessions when cancelled before any unit runs", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
writeV3Session({
  file: sessionRoot + "/c.jsonl", sessionId: "sess-c", cwd: projectA,
  windows: [{ userText: "Cancelled early", assistantText: "x" }],
});
const controller = new AbortController();
controller.abort();
const report = await importPiHistory(
  { loadSession: loadPiSessionForImport, provider, signal: controller.signal },
  { ...${JSON.stringify(DEFAULT_FILTERS)}, root: sessionRoot, skipProfile: true }
);
scenario = { loaded: report.sessionsLoaded, calls: providerCalls.length };
`);
    expect(out).toEqual({ loaded: 0, calls: 0 });
  });

  it("changes the listing revision when a saved directory map changes", () => {
    const out = runScenario(`
const { mkdirSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
const moved = base + "/moved-away";
writeV3Session({
  file: sessionRoot + "/moved.jsonl", sessionId: "sess-moved", cwd: moved,
  windows: [{ userText: "Moved", assistantText: "y", timestamp: "2026-01-01T11:00:00.000Z" }],
});
const { validateImportSource } = await import(${JSON.stringify(sourcesUrl)});
const { listImportSessions } = await import(${JSON.stringify(sessionsUrl)});
const source = validateImportSource("pi", sessionRoot);
const match = { host: "pi", scope: "all-projects", pathMaps: [], cwd: projectA };
CONFIG.importPathMaps = [{ from: moved, to: projectA }];
const toA = await listImportSessions({ sourceToken: source.sourceToken, refresh: true }, match);
CONFIG.importPathMaps = [{ from: moved, to: projectB }];
const toB = await listImportSessions({ sourceToken: source.sourceToken, refresh: true }, match);
scenario = {
  keys: [toA.rows.map((row) => row.key), toB.rows.map((row) => row.key)],
  sameRevision: toA.revision === toB.revision,
};
`);
    // Same session keys, different target: the revision must still change.
    expect(out.keys).toEqual([["moved.jsonl"], ["moved.jsonl"]]);
    expect(out.sameRevision).toBe(false);
  });

  it("lists and imports the same sessions, with maps, and refuses stale selections", () => {
    const out = runScenario(`
const { mkdirSync, rmSync } = await import("node:fs");
mkdirSync(sessionRoot, { recursive: true });
const moved = base + "/moved-away";
writeV3Session({
  file: sessionRoot + "/here.jsonl", sessionId: "sess-here", cwd: projectA,
  windows: [{ userText: "Here", assistantText: "x", timestamp: "2026-01-01T10:00:00.000Z" }],
});
writeV3Session({
  file: sessionRoot + "/moved.jsonl", sessionId: "sess-moved", cwd: moved,
  windows: [{ userText: "Moved", assistantText: "y", timestamp: "2026-01-01T11:00:00.000Z" }],
});
const { validateImportSource } = await import(${JSON.stringify(sourcesUrl)});
const { listImportSessions, resolveImportSelection } = await import(${JSON.stringify(sessionsUrl)});
const { runHistoryImport } = await import(${JSON.stringify(runImportUrl)});
const source = validateImportSource("pi", sessionRoot);
const match = { host: "pi", scope: "current-project", project: projectA, pathMaps: [{ from: moved, to: projectA }], cwd: projectA };
const noMap = await listImportSessions({ sourceToken: source.sourceToken, refresh: true }, { ...match, pathMaps: [] });
const list = await listImportSessions({ sourceToken: source.sourceToken, refresh: true }, match);
const all = { mode: "all", excludedKeys: [], revision: list.revision, listedAt: list.listedAt };
const selection = await resolveImportSelection(source.sourceToken, all, match);
const report = await runHistoryImport(
  "pi",
  { help: false, dryRun: true, force: false, skipMemories: false, skipProfile: true, scope: "current-project", project: projectA, pathMaps: match.pathMaps, source: sessionRoot, errors: [] },
  { cwd: projectA, models: {}, selection: { keys: selection.keys, cutoff: selection.cutoff } }
);
const ids = { mode: "ids", sessions: list.rows.map((row) => ({ key: row.key, directory: row.directory })), listedAt: list.listedAt };
writeV3Session({
  file: sessionRoot + "/new.jsonl", sessionId: "sess-new", cwd: projectA,
  windows: [{ userText: "New", assistantText: "z", timestamp: "2026-01-01T12:00:00.000Z" }],
});
const staleAll = await resolveImportSelection(source.sourceToken, all, match).then(() => "ok", (e) => e.status);
const stillIds = await resolveImportSelection(source.sourceToken, ids, match).then((r) => r.keys.length, (e) => e.status);
rmSync(sessionRoot + "/here.jsonl");
const staleIds = await resolveImportSelection(source.sourceToken, ids, match).then(() => "ok", (e) => e.status);
scenario = {
  noMap: { total: noMap.total, unresolved: noMap.unresolvedCount },
  listed: list.rows.map((row) => [row.key, row.via]).sort(),
  imported: report.units.map((u) => u.sessionId).sort(),
  staleAll, stillIds, staleIds,
  json: JSON.stringify(list),
};
`);
    expect(out.noMap).toEqual({ total: 1, unresolved: 1 });
    expect(out.listed).toEqual([
      ["here.jsonl", "recorded"],
      ["moved.jsonl", "mapped"],
    ]);
    expect(out.imported).toEqual(["sess-here", "sess-moved"]);
    expect(out.staleAll).toBe(409);
    expect(out.stillIds).toBe(2);
    expect(out.staleIds).toBe(409);
    expect(out.json).not.toContain("Here");
    expect(out.json).not.toContain("Moved");
  });
});
