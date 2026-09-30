import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultClaudeProjectsRoot,
  discoverClaudeSessions,
  loadClaudeSession,
  openClaudeHistorySource,
  type LoadedClaudeSession,
} from "../src/importer/claude-reader.js";

// The dry-run scenario spawns a Bun process with a real temp store.
setDefaultTimeout(30_000);

const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "claude-transcripts");
const MAIN_KEY = "-tmp-claude-fixture-project/11111111-1111-4111-8111-111111111111.jsonl";
const OTHER_KEY = "-tmp-misleading-folder-name/22222222-2222-4222-8222-222222222222.jsonl";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      chmodSync(dir, 0o755);
    } catch {
      // Already removed.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Copy the fixture transcripts into a fresh temp root. */
function fixtureRoot(): string {
  const root = join(tempDir("claude-reader-"), "projects");
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  return root;
}

/** Real project folders for the recorded fixture paths, through path maps. */
function fixturePathMaps() {
  const base = tempDir("claude-projects-");
  const main = join(base, "main");
  const other = join(base, "other");
  mkdirSync(main);
  mkdirSync(other);
  return {
    main,
    other,
    pathMaps: [
      { from: "/tmp/claude-fixture-project", to: main },
      { from: "/tmp/claude-fixture-other", to: other },
    ],
  };
}

describe("defaultClaudeProjectsRoot", () => {
  it("is ~/.claude/projects under the home folder", () => {
    expect(defaultClaudeProjectsRoot()).toBe(join(homedir(), ".claude", "projects"));
  });

  it("follows the claudeConfigDir setting when discovery has no root", () => {
    const home = tempDir("claude-home-");
    const custom = join(home, "custom-claude");
    cpSync(FIXTURE_ROOT, join(custom, "projects"), { recursive: true });
    mkdirSync(join(home, ".config", "omms"), { recursive: true });
    writeFileSync(
      join(home, ".config", "omms", "omms.jsonc"),
      JSON.stringify({ claudeConfigDir: custom })
    );
    const readerUrl = pathToFileURL(join(import.meta.dir, "../src/importer/claude-reader.js")).href;
    const script = `const { discoverClaudeSessions } = await import(${JSON.stringify(readerUrl)});
console.log("RESULT:" + JSON.stringify(discoverClaudeSessions().sessions.map((s) => s.key)));`;
    const scriptPath = join(home, "scenario.mjs");
    writeFileSync(scriptPath, script);
    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
    };
    delete env.CLAUDE_CONFIG_DIR;
    const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: home, env });
    const match = proc.stdout.toString().match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`no result: ${proc.stdout}\n${proc.stderr}`);
    expect(JSON.parse(match[1]!)).toEqual([OTHER_KEY, MAIN_KEY]);
  });

  it("is where discovery looks without a root", () => {
    // Bun reads the home folder once at start, so a child process gets the fake one.
    const home = tempDir("claude-home-");
    cpSync(FIXTURE_ROOT, join(home, ".claude", "projects"), { recursive: true });
    const readerUrl = pathToFileURL(join(import.meta.dir, "../src/importer/claude-reader.js")).href;
    const script = `const { defaultClaudeProjectsRoot, discoverClaudeSessions } = await import(${JSON.stringify(readerUrl)});
console.log("RESULT:" + JSON.stringify({ root: defaultClaudeProjectsRoot(), keys: discoverClaudeSessions().sessions.map((s) => s.key) }));`;
    const scriptPath = join(home, "scenario.mjs");
    writeFileSync(scriptPath, script);
    const proc = Bun.spawnSync(["bun", "run", scriptPath], {
      cwd: home,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    const match = proc.stdout.toString().match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`no result: ${proc.stdout}\n${proc.stderr}`);
    expect(JSON.parse(match[1]!)).toEqual({
      root: join(home, ".claude", "projects"),
      keys: [OTHER_KEY, MAIN_KEY],
    });
  });
});

describe("discoverClaudeSessions", () => {
  it("lists sessions oldest first with the recorded directory and date", () => {
    const root = fixtureRoot();
    const result = discoverClaudeSessions({ root });
    expect(result.unrecognized).toEqual([]);
    expect(result.sessions).toEqual([
      {
        file: join(
          root,
          "-tmp-misleading-folder-name",
          "22222222-2222-4222-8222-222222222222.jsonl"
        ),
        key: OTHER_KEY,
        sessionId: "22222222-2222-4222-8222-222222222222",
        // From the first user entry, not from the folder name.
        cwd: "/tmp/claude-fixture-other",
        timestamp: Date.parse("2026-02-01T08:00:00.000Z"),
      },
      {
        file: join(
          root,
          "-tmp-claude-fixture-project",
          "11111111-1111-4111-8111-111111111111.jsonl"
        ),
        key: MAIN_KEY,
        sessionId: "11111111-1111-4111-8111-111111111111",
        cwd: "/tmp/claude-fixture-project",
        timestamp: Date.parse("2026-03-01T09:59:59.000Z"),
      },
    ]);
  });

  it("uses the --root folder and ignores subagent transcripts below session folders", () => {
    const root = fixtureRoot();
    const nested = join(root, "-tmp-claude-fixture-project", "11111111", "subagents");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "agent-1.jsonl"), readFileSync(join(root, OTHER_KEY)));
    expect(discoverClaudeSessions({ root }).sessions.map((session) => session.key)).toEqual([
      OTHER_KEY,
      MAIN_KEY,
    ]);
    expect(
      discoverClaudeSessions({ root: join(root, "-tmp-claude-fixture-project") }).sessions.map(
        (session) => session.key
      )
    ).toEqual(["11111111-1111-4111-8111-111111111111.jsonl"]);
    expect(discoverClaudeSessions({ root: join(root, OTHER_KEY) }).sessions.length).toBe(1);
    expect(discoverClaudeSessions({ root: join(root, "missing") })).toEqual({
      sessions: [],
      unrecognized: [],
    });
  });

  it("limits the list with maxSessions", () => {
    const root = fixtureRoot();
    expect(discoverClaudeSessions({ root, maxSessions: 1 }).sessions.map((s) => s.key)).toEqual([
      OTHER_KEY,
    ]);
  });

  it("reports a folder it cannot read, and treats a missing root as empty", () => {
    const root = fixtureRoot();
    const locked = join(root, "-tmp-locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    const runsAsRoot = process.getuid?.() === 0 || process.platform === "win32";
    try {
      const result = discoverClaudeSessions({ root });
      const reasons = result.unrecognized.map((item) => [
        item.file.slice(root.length + 1),
        item.reason,
      ]);
      if (!runsAsRoot) expect(reasons).toContainEqual(["-tmp-locked", "unreadable: EACCES"]);
      expect(discoverClaudeSessions({ root: join(root, "missing") }).unrecognized).toEqual([]);
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it("reports files it cannot read or use", () => {
    const root = fixtureRoot();
    const project = join(root, "-tmp-bad");
    mkdirSync(project);
    mkdirSync(join(project, "folder.jsonl"));
    writeFileSync(join(project, "empty.jsonl"), "");
    writeFileSync(join(project, "no-user.jsonl"), '{"type":"summary","summary":"x"}\nnot json\n');
    const locked = join(project, "locked.jsonl");
    writeFileSync(locked, readFileSync(join(root, OTHER_KEY)));
    chmodSync(locked, 0o000);
    const runsAsRoot = process.getuid?.() === 0 || process.platform === "win32";

    const result = discoverClaudeSessions({ root });
    const reasons = Object.fromEntries(
      result.unrecognized.map((item) => [item.file.slice(project.length + 1), item.reason])
    );
    expect(reasons["folder.jsonl"]).toBe("not a regular file");
    expect(reasons["empty.jsonl"]).toBe("no user entry");
    expect(reasons["no-user.jsonl"]).toBe("no user entry");
    if (!runsAsRoot) expect(reasons["locked.jsonl"]).toBe("unreadable: EACCES");
    expect(result.sessions.map((session) => session.key)).toEqual(
      runsAsRoot ? [OTHER_KEY, "-tmp-bad/locked.jsonl", MAIN_KEY] : [OTHER_KEY, MAIN_KEY]
    );
    chmodSync(locked, 0o644);
  });
});

describe("loadClaudeSession", () => {
  it("parses one transcript into windows and skip counts", () => {
    const root = fixtureRoot();
    const session = loadClaudeSession(join(root, MAIN_KEY));
    expect(session.sessionId).toBe("11111111-1111-4111-8111-111111111111");
    expect(session.sourceFile).toBe(join(root, MAIN_KEY));
    expect(session.cwd).toBe("/tmp/claude-fixture-project");
    expect(session.windows.map((window) => window.userEntryId)).toEqual(["u1", "u2", "u3"]);
    expect(session.unreadableLines).toBe(1);
    expect(session.unknownTypes).toBe(1);
  });
});

describe("openClaudeHistorySource", () => {
  it("counts units up front and loads each session only when open() reaches it", async () => {
    const root = fixtureRoot();
    const { main, other, pathMaps } = fixturePathMaps();
    const loaded: string[] = [];
    const loadSession = (file: string): LoadedClaudeSession => {
      loaded.push(file);
      return loadClaudeSession(file);
    };

    const source = await openClaudeHistorySource({ root, pathMaps }, { loadSession });
    expect(source.total).toBe(4);
    expect(source.sessionsDiscovered).toBe(2);
    expect(source.sessionsLoaded).toBe(2);
    expect(source.unreadableLines).toBe(1);
    expect(source.unknownTypes).toBe(1);
    expect(
      source.projects.map((project) => [project.directory, project.sessions, project.units])
    ).toEqual([
      [other, 1, 1],
      [main, 1, 3],
    ]);
    const afterCount = loaded.length;
    expect(afterCount).toBe(2);

    const iterator = source.open()[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(loaded.length).toBe(afterCount + 1);
    expect(first.value).toMatchObject({
      sessionId: "22222222-2222-4222-8222-222222222222",
      directory: other,
      sourceFile: join(root, OTHER_KEY),
    });
    expect(first.value.units.map((unit: { userEntryId: string }) => unit.userEntryId)).toEqual([
      "b-u1",
    ]);
    const second = await iterator.next();
    expect(loaded.length).toBe(afterCount + 2);
    expect(second.value.directory).toBe(main);
    expect(second.value.units.length).toBe(3);
    expect((await iterator.next()).done).toBe(true);
  });

  it("applies date, cutoff, session, selection, project, and path map filters", async () => {
    const root = fixtureRoot();
    const { main, pathMaps } = fixturePathMaps();

    const since = await openClaudeHistorySource({
      root,
      pathMaps,
      since: Date.parse("2026-03-01T10:01:00.000Z"),
    });
    expect(since.total).toBe(2);

    const cutoff = await openClaudeHistorySource({
      root,
      pathMaps,
      cutoff: Date.parse("2026-03-01T10:06:00.000Z"),
    });
    expect(cutoff.total).toBe(3);
    expect(cutoff.unitsHeldBack).toBe(1);

    const bySession = await openClaudeHistorySource({
      root,
      pathMaps,
      session: "11111111-1111-4111-8111-111111111111",
    });
    expect(bySession.total).toBe(3);
    expect(bySession.sessionsFilteredOut).toBe(1);

    const bySelection = await openClaudeHistorySource({
      root,
      pathMaps,
      selectionKeys: [OTHER_KEY],
    });
    expect(bySelection.total).toBe(1);

    const byProject = await openClaudeHistorySource({ root, pathMaps, project: main });
    expect(byProject.total).toBe(3);
    expect(byProject.sessionsFilteredOut).toBe(1);

    const unmapped = await openClaudeHistorySource({ root });
    expect(unmapped.total).toBe(0);
    expect(unmapped.unresolvableSessions.map((item) => item.cwd).sort()).toEqual([
      "/tmp/claude-fixture-other",
      "/tmp/claude-fixture-project",
    ]);
  });
});

describe("importClaudeHistory", () => {
  it("reports sessions and units per project in a dry run and stores nothing", () => {
    const base = tempDir("claude-import-");
    const root = join(base, "projects");
    cpSync(FIXTURE_ROOT, root, { recursive: true });
    const url = (path: string) => pathToFileURL(join(import.meta.dir, path)).href;
    const script = `
import { mock } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
const embeddingStub = { embedWithTimeout: async () => new Float32Array([0.25, 0.5, 0.75, 1]), warmup: async () => {}, isWarmedUp: true };
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
const { memoryClient } = await import(${JSON.stringify(url("../src/services/client.js"))});
const { importLedgerDbPath } = await import(${JSON.stringify(url("../src/importer/ledger.js"))});
const { importClaudeHistory } = await import(${JSON.stringify(url("../src/importer/claude-import.js"))});
mkdirSync(base + "/main");
mkdirSync(base + "/other");
let calls = 0;
const report = await importClaudeHistory(
  { provider: { summarize: async () => { calls++; throw new Error("dry run called the model"); } } },
  {
    scope: "all-projects",
    currentDirectory: "/nonexistent",
    root: base + "/projects",
    dryRun: true,
    pathMaps: [
      { from: "/tmp/claude-fixture-project", to: base + "/main" },
      { from: "/tmp/claude-fixture-other", to: base + "/other" },
    ],
  }
);
const list = await memoryClient.listMemories(null, 1000, "all-projects");
const result = {
  report,
  calls,
  memoryCount: list.success ? list.memories.length : -1,
  ledgerExists: existsSync(importLedgerDbPath()),
};
await memoryClient.close();
console.log("RESULT:" + JSON.stringify(result));
`;
    const scriptPath = join(base, "scenario.mjs");
    writeFileSync(scriptPath, script);
    const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: base });
    const match = proc.stdout.toString().match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`no result: ${proc.stdout}\n${proc.stderr}`);
    const out = JSON.parse(match[1]!);

    expect(out.report.dryRun).toBe(true);
    expect(out.report.sessionsDiscovered).toBe(2);
    expect(out.report.sessionsLoaded).toBe(2);
    expect(out.report.unitsTotal).toBe(4);
    expect(out.report.unitsWouldImport).toBe(4);
    expect(out.report.unreadableLines).toBe(1);
    expect(out.report.unknownTypes).toBe(1);
    expect(
      out.report.projects.map((project: any) => [
        project.directory.slice(base.length),
        project.sessions,
        project.units,
      ])
    ).toEqual([
      ["/other", 1, 1],
      ["/main", 1, 3],
    ]);
    expect(out.report.units.map((unit: any) => unit.key)).toEqual([
      "claude-code:22222222-2222-4222-8222-222222222222:b-u1:b-a1",
      "claude-code:11111111-1111-4111-8111-111111111111:u1:a1-text",
      "claude-code:11111111-1111-4111-8111-111111111111:u2:a2-final",
      "claude-code:11111111-1111-4111-8111-111111111111:u3:a3-text",
    ]);
    expect(out.calls).toBe(0);
    expect(out.memoryCount).toBe(0);
    expect(out.ledgerExists).toBe(false);
  });
});
