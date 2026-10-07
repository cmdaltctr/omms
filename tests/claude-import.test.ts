import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Each scenario spawns a fresh Bun process and runs several imports against a
// real database, which takes longer than Bun's 5 s default on slow runners.
setDefaultTimeout(30_000);

const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "claude-transcripts");
const MAIN_SESSION = "11111111-1111-4111-8111-111111111111";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const url = (path: string) => pathToFileURL(join(import.meta.dir, path)).href;

/**
 * Engine-level Claude Code import: real storage (temp libSQL), real project
 * identity, the fixture transcripts, and `runHistoryImport` as the CLI and web
 * app call it. Only the embedding service, the ready gate, and the logger are
 * stubbed; the capture provider is a scripted stub.
 */
function runScenario(body: string): any {
  const base = mkdtempSync(join(tmpdir(), "claude-import-"));
  tempDirs.push(base);
  cpSync(FIXTURE_ROOT, join(base, "projects"), { recursive: true });
  const script = `
import { mock } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
const embeddingStub = {
  embedWithTimeout: async () => new Float32Array([0.25, 0.5, 0.75, 1]),
  warmup: async () => {},
  isWarmedUp: true,
};
mock.module(${JSON.stringify(url("../src/services/embedding.js"))}, () => ({
  embeddingService: embeddingStub,
  EmbeddingService: class { static getInstance() { return embeddingStub; } },
  applyEmbeddingTaskPrefix: (_model, text) => text,
  loadLocalTransformersBackend: async () => null,
}));
mock.module(${JSON.stringify(url("../src/services/turso/ready.js"))}, () => ({
  ensureTursoReady: async () => {},
  resetTursoReady: () => {},
}));
mock.module(${JSON.stringify(url("../src/services/logger.js"))}, () => ({ log: () => {} }));

const { CONFIG } = await import(${JSON.stringify(url("../src/config.js"))});
const base = ${JSON.stringify(base)};
CONFIG.storagePath = base + "/data";
CONFIG.embeddingDimensions = 4;
CONFIG.autoCaptureMaxContextBytes = 131072;
CONFIG.autoCaptureEnabled = true;
CONFIG.injectProfile = false;

const { memoryClient } = await import(${JSON.stringify(url("../src/services/client.js"))});
const { importLedgerDbPath } = await import(${JSON.stringify(url("../src/importer/ledger.js"))});
const { parseHistoryImportArgs } = await import(${JSON.stringify(url("../src/importer/import-args.js"))});
const { runHistoryImport } = await import(${JSON.stringify(url("../src/importer/run-import.js"))});
const { loadClaudeSession } = await import(${JSON.stringify(url("../src/importer/claude-reader.js"))});
const { captureConversation } = await import(${JSON.stringify(url("../src/core/capture.js"))});

const root = base + "/projects";
const main = base + "/main";
const other = base + "/other";
mkdirSync(main);
mkdirSync(other);

const providerCalls = [];
const provider = {
  summarize: async (request) => {
    providerCalls.push(request.userPrompt);
    return {
      summary: "## Request\\n" + request.userPrompt + "\\n\\n## Outcome\\nImported fixture outcome.",
      type: "technical-decision",
      tags: ["claude-fixture"],
    };
  },
};

function argsFor(extra = []) {
  const args = parseHistoryImportArgs(
    ["--scope", "all-projects", "--root", root, "--skip-profile",
     "--map", "/tmp/claude-fixture-project=" + main, "--map", "/tmp/claude-fixture-other=" + other,
     ...extra],
    { host: "claude-code", surface: "cli" }
  );
  if (args.errors.length) throw new Error(args.errors.join("; "));
  return args;
}

async function runImport(extra = [], capture) {
  return runHistoryImport("claude-code", argsFor(extra), {
    cwd: base,
    models: capture ? { capture } : {},
    savedPathMaps: [],
  });
}

async function storedMemories() {
  const list = await memoryClient.listMemories(null, 1000, "all-projects");
  return list.success ? list.memories : [];
}

function counts(report) {
  return {
    total: report.unitsTotal,
    wouldImport: report.unitsWouldImport,
    imported: report.unitsImported,
    skipped: report.unitsSkipped,
    failed: report.unitsFailed,
    alreadyHandled: report.unitsAlreadyHandled,
    reasons: report.skipReasons,
  };
}

let scenario;
${body}

await memoryClient.close();
console.log("RESULT:" + JSON.stringify(scenario ?? null));
`;
  const scriptPath = join(base, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: base });
  const match = proc.stdout.toString().match(/RESULT:(.*)$/m);
  if (!match) throw new Error(`no result: ${proc.stdout}\n${proc.stderr}`);
  return JSON.parse(match[1]!);
}

describe("Claude Code history import", () => {
  it("reads the claudeConfigDir folder when no --root is given, in the terminal and on the page", () => {
    const out = runScenario(`
delete process.env.CLAUDE_CONFIG_DIR;
CONFIG.claudeConfigDir = base;
const args = parseHistoryImportArgs(
  ["--scope", "all-projects", "--dry-run", "--skip-profile"],
  { host: "claude-code", surface: "cli" }
);
const dry = await runHistoryImport("claude-code", args, { cwd: base, models: {}, savedPathMaps: [] });
const { listImportSessions } = await import(${JSON.stringify(url("../src/importer/import-sessions.js"))});
const page = await listImportSessions(
  { refresh: true },
  { host: "claude-code", scope: "all-projects", pathMaps: [], cwd: base }
);
scenario = { base, root: dry.root, discovered: dry.sessionsDiscovered, listed: page.total };
`);
    expect(out.root).toBe(join(out.base, "projects"));
    expect(out.discovered).toBeGreaterThan(0);
    expect(out.listed).toBe(out.discovered);
  });

  it("stores nothing in a dry run, one memory per window in a real run, and skips all on rerun", () => {
    const out = runScenario(`
const dry = await runImport(["--dry-run"]);
const afterDry = { memories: (await storedMemories()).length, ledger: existsSync(importLedgerDbPath()) };
const real = await runImport([], provider);
const memories = await storedMemories();
const callsAfterReal = providerCalls.length;
const rerun = await runImport([], provider);
scenario = {
  dry: counts(dry),
  afterDry,
  real: counts(real),
  callsAfterReal,
  memories: memories.map((memory) => ({
    host: memory.metadata?.host,
    sourceType: memory.metadata?.sourceType,
    hostSessionId: memory.metadata?.hostSessionId,
    importId: memory.metadata?.importId,
    sourceEntryIds: memory.metadata?.sourceEntryIds,
  })),
  rerun: counts(rerun),
  callsAfterRerun: providerCalls.length,
};
`);
    expect(out.dry).toMatchObject({ total: 4, wouldImport: 4, imported: 0 });
    expect(out.afterDry).toEqual({ memories: 0, ledger: false });

    expect(out.real).toMatchObject({ total: 4, imported: 4, skipped: 0, failed: 0 });
    expect(out.callsAfterReal).toBe(4);
    expect(out.memories).toHaveLength(4);
    for (const memory of out.memories) {
      expect(memory.host).toBe("claude-code");
      expect(memory.sourceType).toBe("history-import");
      expect(memory.importId.startsWith(`claude-code:${memory.hostSessionId}:`)).toBe(true);
      expect(memory.sourceEntryIds.length).toBeGreaterThan(0);
    }
    expect(out.memories.map((memory: any) => memory.importId).sort()).toEqual([
      "claude-code:11111111-1111-4111-8111-111111111111:u1:a1-text",
      "claude-code:11111111-1111-4111-8111-111111111111:u2:a2-final",
      "claude-code:11111111-1111-4111-8111-111111111111:u3:a3-text",
      "claude-code:22222222-2222-4222-8222-222222222222:b-u1:b-a1",
    ]);

    expect(out.rerun).toMatchObject({ total: 4, imported: 0, alreadyHandled: 4, failed: 0 });
    expect(out.callsAfterRerun).toBe(4);
  });

  it("skips a window that live capture already saved, by its entry ids", () => {
    const out = runScenario(`
// Save the second main-session turn the way the Stop hook does: the reader's
// window, host claude-code, the Claude session id, and source type live-capture.
const session = loadClaudeSession(root + "/-tmp-claude-fixture-project/${MAIN_SESSION}.jsonl");
const window = session.windows[1];
const live = await captureConversation(
  {
    host: "claude-code",
    hostSessionId: session.sessionId,
    sourceType: "live-capture",
    projectDirectory: main,
    userPrompt: window.userPrompt,
    textResponses: window.textResponses,
    toolCalls: window.toolCalls,
    sourceEntryIds: window.sourceEntryIds,
    sourceTimestamp: window.sourceTimestamp,
  },
  provider
);
const callsAfterLive = providerCalls.length;
const dry = await runImport(["--dry-run"]);
const real = await runImport([], provider);
const memories = await storedMemories();
scenario = {
  live: live.status,
  liveEntry: window.userEntryId,
  callsAfterLive,
  dry: counts(dry),
  dryUnits: dry.units.map((unit) => [unit.userEntryId, unit.status, unit.reason ?? null]),
  real: counts(real),
  providerCalls: providerCalls.length,
  sourceTypes: memories.map((memory) => memory.metadata?.sourceType).sort(),
};
`);
    expect(out.live).toBe("captured");
    expect(out.liveEntry).toBe("u2");
    expect(out.callsAfterLive).toBe(1);
    expect(out.dry).toMatchObject({ skipped: 1, wouldImport: 3, reasons: { "live-captured": 1 } });
    expect(out.dryUnits).toContainEqual(["u2", "skipped", "live-captured"]);
    expect(out.real).toMatchObject({
      imported: 3,
      skipped: 1,
      failed: 0,
      reasons: { "live-captured": 1 },
    });
    // The live turn never reached the model a second time.
    expect(out.providerCalls).toBe(4);
    expect(out.sourceTypes).toEqual([
      "history-import",
      "history-import",
      "history-import",
      "live-capture",
    ]);
  });

  it("re-analyses done profile prompts only with --force", () => {
    const out = runScenario(`
CONFIG.userEmailOverride = "test@example.invalid";
let profileCalls = 0;
const profileModel = {
  provider: "test",
  modelId: "profile",
  complete: async () => {
    profileCalls++;
    return JSON.stringify({ preferences: [], patterns: [], workflows: [] });
  },
};
async function profileRun(extra) {
  const args = parseHistoryImportArgs(
    ["--scope", "all-projects", "--root", root, "--skip-memories",
     "--map", "/tmp/claude-fixture-project=" + main, "--map", "/tmp/claude-fixture-other=" + other,
     ...extra],
    { host: "claude-code", surface: "cli" }
  );
  if (args.errors.length) throw new Error(args.errors.join("; "));
  const report = await runHistoryImport("claude-code", args, {
    cwd: base,
    models: { profile: profileModel },
    savedPathMaps: [],
  });
  return { ...report.profile, calls: profileCalls };
}
const first = await profileRun([]);
const rerun = await profileRun([]);
const forcedDry = await profileRun(["--force", "--dry-run"]);
const forced = await profileRun(["--force"]);
scenario = { first, rerun, forcedDry, forced, memories: (await storedMemories()).length };
`);
    const done = out.first.promptsRecorded;
    expect(done).toBeGreaterThan(0);
    expect(out.first.calls).toBeGreaterThan(0);
    expect(out.rerun).toMatchObject({ promptsRecorded: 0, promptsAlreadyHandled: done });
    expect(out.rerun.calls).toBe(out.first.calls);
    expect(out.forcedDry).toMatchObject({ promptsWouldRecord: done, promptsAlreadyHandled: 0 });
    expect(out.forcedDry.calls).toBe(out.first.calls);
    expect(out.forced).toMatchObject({ promptsRecorded: done, promptsAlreadyHandled: 0 });
    expect(out.forced.calls).toBeGreaterThan(out.first.calls);
    expect(out.memories).toBe(0);
  });
});
