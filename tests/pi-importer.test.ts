import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));

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
const retrievalUrl = pathToFileURL(join(import.meta.dir, "../src/adapters/pi/retrieval.js")).href;

describe("Pi historical importer", () => {
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

  it("applies session, date, and scope filters before expensive work", () => {
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
  });

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
const { buildPiRetrievalSection } = await import(${JSON.stringify(retrievalUrl)});
const piSection = await buildPiRetrievalSection("usearch vector index", projectA, "pi-live-session");

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
});
