import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Each scenario spawns a fresh Bun process and runs several imports against a
// real database, which takes longer than Bun's 5 s default on slow runners.
setDefaultTimeout(30_000);

/**
 * Skill turns as a history import target (tasks 4.2 and 4.3). Real storage
 * (temp libSQL), real project identity, real Pi and Claude Code readers and a
 * real OpenCode database. Only the embedding service, the ready gate and the
 * logger are stubbed; the capture provider is a scripted stub that counts calls.
 */

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const url = (path: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, path)).href);
const CLAUDE_FIXTURES = join(import.meta.dir, "fixtures", "claude-transcripts");

function runScenario(body: string): any {
  const base = mkdtempSync(join(tmpdir(), "skill-import-"));
  tempDirs.push(base);
  cpSync(CLAUDE_FIXTURES, join(base, "projects"), { recursive: true });
  const script = `
import { mock } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
const embeddingStub = {
  embedWithTimeout: async () => new Float32Array([0.25, 0.5, 0.75, 1]),
  warmup: async () => {},
  isWarmedUp: true,
};
mock.module(${url("../src/services/embedding.js")}, () => ({
  embeddingService: embeddingStub,
  EmbeddingService: class { static getInstance() { return embeddingStub; } },
  applyEmbeddingTaskPrefix: (_model, text) => text,
  loadLocalTransformersBackend: async () => null,
}));
mock.module(${url("../src/services/turso/ready.js")}, () => ({
  ensureTursoReady: async () => {},
  resetTursoReady: () => {},
}));
mock.module(${url("../src/services/logger.js")}, () => ({ log: () => {} }));

const { CONFIG } = await import(${url("../src/config.js")});
const base = ${JSON.stringify(base)};
const storage = base + "/data";
CONFIG.storagePath = storage;
CONFIG.embeddingDimensions = 4;
CONFIG.autoCaptureMaxContextBytes = 131072;
CONFIG.autoCaptureEnabled = true;
CONFIG.injectProfile = false;
CONFIG.skillLearning = true;
CONFIG.skillLearningRedact = true;
CONFIG.skillFolders = [];

const { memoryClient } = await import(${url("../src/services/client.js")});
const { tursoConnectionManager } = await import(${url("../src/services/turso/connection-manager.js")});
const { importPiHistory } = await import(${url("../src/importer/importer.js")});
const { loadPiSessionForImport } = await import(${url("../src/importer/session-loader.js")});
const { importLedgerDbPath } = await import(${url("../src/importer/ledger.js")});
const { parseHistoryImportArgs } = await import(${url("../src/importer/import-args.js")});
const { runHistoryImport, formatHistoryImportReport } = await import(${url("../src/importer/run-import.js")});
const { readImportRun } = await import(${url("../src/importer/import-runs.js")});
const { writeV3Session, makeProjectDir } = await import(${url("./pi-import-fixtures.js")});

const sessionRoot = base + "/sessions";
mkdirSync(sessionRoot + "/proj-a", { recursive: true });
const projectA = makeProjectDir(base, "project-a");
const claudeRoot = base + "/projects";
const main = makeProjectDir(base, "main");
const other = makeProjectDir(base, "other");

const providerCalls = [];
const provider = {
  summarize: async (request) => {
    providerCalls.push(request.userPrompt);
    return {
      summary: "## Request\\n" + request.userPrompt + "\\n\\n## Outcome\\nImported fixture outcome.",
      type: "technical-decision",
      tags: ["skill-import"],
    };
  },
};

const skillsDb = storage + "/skills.db";
async function turns() {
  if (!existsSync(skillsDb)) return null;
  const db = await tursoConnectionManager.getConnection(skillsDb);
  return (await db.all("SELECT turn_key FROM turns ORDER BY turn_key")).map((r) => r.turn_key);
}
async function storedMemories() {
  const list = await memoryClient.listMemories(null, 1000, "all-projects");
  return list.success ? list.memories : [];
}
async function ledgerRows() {
  if (!existsSync(importLedgerDbPath())) return null;
  const db = await tursoConnectionManager.getConnection(importLedgerDbPath());
  const table = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'import_ledger'");
  return table ? (await db.get("SELECT COUNT(*) AS n FROM import_ledger")).n : null;
}
function skillCounts(report) {
  return {
    recorded: report.skillTurnsRecorded,
    present: report.skillTurnsAlreadyPresent,
    wouldRecord: report.skillTurnsWouldRecord,
    alreadyRecorded: report.skillTurnsAlreadyRecorded,
  };
}

const PI_WINDOWS = [
  { userText: "First request", assistantText: "First reply", timestamp: "2026-01-01T10:00:00.000Z" },
  { userText: "Second request", assistantText: "Second reply", timestamp: "2026-01-02T10:00:00.000Z" },
];
function writePiSession(windows = PI_WINDOWS) {
  return writeV3Session({ file: sessionRoot + "/proj-a/a.jsonl", sessionId: "sess-a", cwd: projectA, windows });
}
const PI_FILTERS = { scope: "all-projects", currentDirectory: "/nonexistent", root: sessionRoot };
const piDeps = { loadSession: loadPiSessionForImport, provider };

function piArgs(extra = []) {
  const args = parseHistoryImportArgs(["--scope", "all-projects", "--root", sessionRoot, ...extra], { host: "pi", surface: "cli" });
  if (args.errors.length) throw new Error(args.errors.join("; "));
  return args;
}
function claudeArgs(extra = []) {
  const args = parseHistoryImportArgs(
    ["--scope", "all-projects", "--root", claudeRoot,
     "--map", "/tmp/claude-fixture-project=" + main, "--map", "/tmp/claude-fixture-other=" + other, ...extra],
    { host: "claude-code", surface: "cli" }
  );
  if (args.errors.length) throw new Error(args.errors.join("; "));
  return args;
}
const run = (host, args, models = {}, extra = {}) =>
  runHistoryImport(host, args, { cwd: base, models, savedPathMaps: [], ...extra });

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

describe("Pi history import with skill turns", () => {
  it("records turns the memory ledger marks imported, with no new memory or model call", () => {
    const out = runScenario(`
writePiSession();
CONFIG.skillLearning = false;
const first = await importPiHistory(piDeps, PI_FILTERS);
const afterFirst = { calls: providerCalls.length, turns: await turns() };
CONFIG.skillLearning = true;
const second = await importPiHistory(piDeps, PI_FILTERS);
scenario = {
  first: { imported: first.unitsImported, skills: skillCounts(first) },
  afterFirst,
  second: { already: second.unitsAlreadyHandled, imported: second.unitsImported, skills: skillCounts(second) },
  calls: providerCalls.length,
  memories: (await storedMemories()).length,
  turns: await turns(),
};
`);
    expect(out.first.imported).toBe(2);
    expect(out.first.skills.recorded).toBeUndefined();
    expect(out.afterFirst.turns).toBeNull();
    expect(out.second).toEqual({
      already: 2,
      imported: 0,
      skills: { recorded: 2, present: 0 },
    });
    expect(out.calls).toBe(out.afterFirst.calls);
    expect(out.memories).toBe(2);
    expect(out.turns).toHaveLength(2);
    expect(out.turns.every((key: string) => key.startsWith("pi:sess-a:"))).toBe(true);
  });

  it("counts turns in a dry run and writes nothing", () => {
    const out = runScenario(`
writePiSession();
const dry = await importPiHistory(piDeps, { ...PI_FILTERS, dryRun: true });
const afterDry = { exists: existsSync(skillsDb), calls: providerCalls.length };
await importPiHistory(piDeps, PI_FILTERS);
const again = await importPiHistory(piDeps, { ...PI_FILTERS, dryRun: true });
scenario = {
  dry: { wouldImport: dry.unitsWouldImport, skills: skillCounts(dry) },
  afterDry,
  again: skillCounts(again),
  text: formatHistoryImportReport("pi", again),
};
`);
    expect(out.dry).toEqual({ wouldImport: 2, skills: { wouldRecord: 2, alreadyRecorded: 0 } });
    expect(out.afterDry).toEqual({ exists: false, calls: 0 });
    expect(out.again).toEqual({ wouldRecord: 0, alreadyRecorded: 2 });
    expect(out.text).toContain("skill turns: 0 pending, 2 already recorded");
  });

  it("records no turns with --skip-skills or with recording off", () => {
    const out = runScenario(`
writePiSession();
const skipped = await run("pi", piArgs(["--skip-skills", "--skip-profile"]), { capture: provider });
const afterSkip = await turns();
CONFIG.skillLearning = false;
const off = await run("pi", piArgs(["--skip-memories", "--skip-profile"]));
scenario = {
  skipped: { imported: skipped.unitsImported, skills: skillCounts(skipped) },
  afterSkip,
  off: { total: off.unitsTotal, skills: skillCounts(off) },
  turns: await turns(),
};
`);
    expect(out.skipped.imported).toBe(2);
    expect(out.skipped.skills.recorded).toBeUndefined();
    expect(out.afterSkip).toBeNull();
    expect(out.off).toEqual({ total: 2, skills: {} });
    expect(out.turns).toBeNull();
  });

  it("runs a skills-only import with no model, no memory ledger rows and phase skill-turns", () => {
    const out = runScenario(`
writePiSession();
const first = await run("pi", piArgs(["--skip-memories", "--skip-profile"]), {}, { track: { surface: "cli" } });
const runRow = await readImportRun("pi");
const second = await run("pi", piArgs(["--skip-memories", "--skip-profile"]), {}, { track: { surface: "cli" } });
scenario = {
  first: skillCounts(first),
  second: skillCounts(second),
  phase: runRow.phase,
  done: runRow.done,
  state: runRow.state,
  calls: providerCalls.length,
  memories: (await storedMemories()).length,
  ledger: await ledgerRows(),
  turns: await turns(),
  text: formatHistoryImportReport("pi", second),
};
`);
    expect(out.first).toEqual({ recorded: 2, present: 0 });
    expect(out.second).toEqual({ recorded: 0, present: 2 });
    expect(out).toMatchObject({ phase: "skill-turns", done: 2, state: "done", calls: 0 });
    expect(out.memories).toBe(0);
    expect(out.ledger).toBeNull();
    expect(out.turns).toHaveLength(2);
    expect(out.text).toContain("skill turns: 0 recorded, 2 already present");
  });

  it("records a session whose folder is gone in a skills-only run, and keeps the Directory maps list", () => {
    const out = runScenario(`
writePiSession();
const gone = base + "/gone-project";
writeV3Session({ file: sessionRoot + "/proj-a/gone.jsonl", sessionId: "sess-gone", cwd: gone, windows: PI_WINDOWS.slice(0, 1) });
const { readUnresolvedDirectories } = await import(${url("../src/services/backfill-state.js")});
const listed = async () => (await readUnresolvedDirectories("pi")).map((item) => item.directory === gone);
const memory = await run("pi", piArgs(["--skip-profile", "--skip-skills"]), { capture: provider }, { track: { surface: "cli" } });
const afterMemory = await listed();
const skills = await run("pi", piArgs(["--skip-memories", "--skip-profile"]), {}, { track: { surface: "cli" } });
scenario = {
  memory: { imported: memory.unitsImported, unresolvable: memory.unresolvableSessions.length },
  afterMemory,
  skills: { counts: skillCounts(skills), unresolvable: skills.unresolvableSessions.length },
  afterSkills: await listed(),
  gone: (await turns()).filter((key) => key.startsWith("pi:sess-gone:")).length,
  calls: providerCalls.length,
};
`);
    expect(out.memory).toEqual({ imported: 2, unresolvable: 1 });
    expect(out.afterMemory).toEqual([true]);
    expect(out.skills).toEqual({ counts: { recorded: 3, present: 0 }, unresolvable: 0 });
    expect(out.afterSkills).toEqual([true]);
    expect(out.gone).toBe(1);
    expect(out.calls).toBe(2);
  });

  it("keeps one row for a turn recorded live and then imported", () => {
    const out = runScenario(`
const file = writePiSession(PI_WINDOWS.slice(0, 1));
const { capturePiSettledWorkUnit, createPiCaptureState } = await import(${url("../src/adapters/pi/capture.js")});
const live = await capturePiSettledWorkUnit({
  sessionId: "sess-a", directory: projectA, entries: loadPiSessionForImport(file).branch,
  provider, state: createPiCaptureState(),
});
const afterLive = await turns();
const report = await importPiHistory(piDeps, PI_FILTERS);
scenario = {
  live: live.status,
  afterLive,
  skipped: report.skipReasons,
  skills: skillCounts(report),
  memories: (await storedMemories()).length,
  turns: await turns(),
};
`);
    expect(out.live).toBe("captured");
    expect(out.afterLive).toHaveLength(1);
    expect(out.skipped).toEqual({ "live-captured": 1 });
    expect(out.skills).toEqual({ recorded: 0, present: 1 });
    expect(out.memories).toBe(1);
    expect(out.turns).toEqual(out.afterLive);
  });
});

describe("Claude Code history import with skill turns", () => {
  it("keeps one row for a turn recorded live and then imported", () => {
    const out = runScenario(`
const { loadClaudeSession } = await import(${url("../src/importer/claude-reader.js")});
const { recordClaudeSkillTurns } = await import(${url("../src/importer/claude-turn-units.js")});
const { skillTurnRecorder } = await import(${url("../src/services/skill-learning/settings-for.js")});
const session = loadClaudeSession(claudeRoot + "/-tmp-claude-fixture-project/11111111-1111-4111-8111-111111111111.jsonl");
await recordClaudeSkillTurns(session.windows, session.sessionId, main, skillTurnRecorder(main));
const afterLive = await turns();
const report = await run("claude-code", claudeArgs(["--skip-profile"]), { capture: provider });
scenario = {
  liveWindows: session.windows.length,
  afterLive,
  imported: report.unitsImported,
  skills: skillCounts(report),
  turns: await turns(),
};
`);
    expect(out.liveWindows).toBeGreaterThan(0);
    expect(out.afterLive).toHaveLength(out.liveWindows);
    expect(out.skills.present).toBe(out.liveWindows);
    expect(out.turns).toHaveLength(out.liveWindows + out.skills.recorded);
    expect(new Set(out.turns).size).toBe(out.turns.length);
    for (const key of out.afterLive) expect(out.turns).toContain(key);
  });

  it("records turns in a skills-only import with no capture model", () => {
    const out = runScenario(`
const report = await run("claude-code", claudeArgs(["--skip-memories", "--skip-profile"]));
scenario = { skills: skillCounts(report), calls: providerCalls.length, turns: await turns() };
`);
    expect(out.calls).toBe(0);
    expect(out.skills.recorded).toBeGreaterThan(0);
    expect(out.turns).toHaveLength(out.skills.recorded);
  });
});

describe("OpenCode history import with skill turns", () => {
  it("records turns in a skills-only import with no provider or profile model", () => {
    const out = runScenario(`
const { DatabaseSync } = await import("node:sqlite");
const historyPath = base + "/opencode.db";
const db = new DatabaseSync(historyPath);
db.exec(\`CREATE TABLE project (id TEXT, worktree TEXT);
  CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER);
  CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
  CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);\`);
db.prepare("INSERT INTO project VALUES (?, ?)").run("p", projectA);
db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("ses-1", "p", null, projectA, 1);
db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg-1", "ses-1", 10, JSON.stringify({ role: "user" }));
db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("p1", "msg-1", "ses-1", 10, JSON.stringify({ type: "text", text: "Search the web" }));
db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg-2", "ses-1", 11, JSON.stringify({ role: "assistant" }));
db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("p2", "msg-2", "ses-1", 11, JSON.stringify({ type: "text", text: "Found three pages" }));
db.close();
const { importOpencodeHistory } = await import(${url("../src/importer/opencode-import.js")});
const report = await importOpencodeHistory({ dbPath: historyPath, skipMemories: true, skipProfile: true });
scenario = { skills: skillCounts(report), calls: providerCalls.length, turns: await turns() };
`);
    expect(out.calls).toBe(0);
    expect(out.skills).toEqual({ recorded: 1, present: 0 });
    expect(out.turns).toEqual(["opencode:ses-1:msg-1"]);
  });

  it("records a session whose folder is gone in a skills-only import; a memories preview skips it", () => {
    const out = runScenario(`
const { DatabaseSync } = await import("node:sqlite");
const historyPath = base + "/opencode.db";
const gone = base + "/gone-project";
const db = new DatabaseSync(historyPath);
db.exec(\`CREATE TABLE project (id TEXT, worktree TEXT);
  CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER);
  CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
  CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);\`);
db.prepare("INSERT INTO project VALUES (?, ?)").run("p", gone);
db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("ses-1", "p", null, gone, 1);
db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg-1", "ses-1", 10, JSON.stringify({ role: "user" }));
db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("p1", "msg-1", "ses-1", 10, JSON.stringify({ type: "text", text: "Search the web" }));
db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg-2", "ses-1", 11, JSON.stringify({ role: "assistant" }));
db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("p2", "msg-2", "ses-1", 11, JSON.stringify({ type: "text", text: "Found three pages" }));
db.close();
const { importOpencodeHistory } = await import(${url("../src/importer/opencode-import.js")});
const preview = await importOpencodeHistory({ dbPath: historyPath, dryRun: true, skipProfile: true });
const skillsOnly = await importOpencodeHistory({ dbPath: historyPath, skipMemories: true, skipProfile: true });
const recorded = await turns();
const store = await tursoConnectionManager.getConnection(skillsDb);
scenario = {
  preview: { unresolved: preview.unresolvedProjects.map((p) => p.directory === gone), wouldImport: preview.unitsWouldImport, skills: skillCounts(preview) },
  skills: skillCounts(skillsOnly),
  unresolved: skillsOnly.unresolvedProjects.length,
  projects: recorded ? (await store.all("SELECT DISTINCT project_name FROM turns")).map((r) => r.project_name) : null,
  turns: recorded,
};
`);
    expect(out.preview).toEqual({
      unresolved: [true],
      wouldImport: 0,
      skills: { wouldRecord: 0, alreadyRecorded: 0 },
    });
    expect(out.skills).toEqual({ recorded: 1, present: 0 });
    expect(out.unresolved).toBe(0);
    expect(out.projects).toEqual(["gone-project"]);
    expect(out.turns).toEqual(["opencode:ses-1:msg-1"]);
  });
});
