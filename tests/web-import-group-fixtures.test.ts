import { afterEach, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CONFIG } from "../src/config.js";
import { SettingsImportJobs } from "../src/importer/web-import-jobs.js";
import { matchImportSessions, resolveImportSelection } from "../src/importer/import-sessions.js";
import {
  validateImportSource,
  readImportSourceToken,
  importSourceKey,
} from "../src/importer/import-sources.js";
import { opencodeSnapshots } from "../src/importer/opencode-snapshot.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";
import { readWaitingProfilePrompts } from "../src/importer/web-import-profile-estimate.js";
import type { ImportHost } from "../src/importer/import-args.js";
import type { GroupImportJob } from "../src/importer/web-import-group.js";
import type { HistoryImportReport } from "../src/importer/run-import.js";
import { fixture as createFixture } from "./web-import-group-fixture.js";

const dirs: string[] = [];
const sourceHandles: DatabaseSync[] = [];
const originalStorage = CONFIG.storagePath;
afterEach(async () => {
  await opencodeSnapshots.closeAll();
  await tursoConnectionManager.closeAll();
  CONFIG.storagePath = originalStorage;
  for (const db of sourceHandles.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const completedReport = (): HistoryImportReport => ({
  dryRun: false,
  root: "",
  sessionsDiscovered: 1,
  sessionsLoaded: 1,
  sessionsFilteredOut: 0,
  sessionsUnrecognized: 0,
  unitsTotal: 1,
  unitsImported: 1,
  unitsWouldImport: 0,
  unitsAlreadyHandled: 0,
  unitsSkipped: 0,
  unitsFailed: 0,
  projects: [],
  units: [],
  skipReasons: {},
  unresolvableSessions: [],
  loadErrors: [],
});
const ready = async () => ({
  external: { state: "missing-key" as const, provider: "test", model: null },
  opencode: { available: false, models: [] },
  piReader: { available: true },
  claudeCode: {
    available: true as const,
    defaultRoot: "/tmp",
    defaultRootFound: true,
    modelChoices: ["external"] as ["external"],
  },
});
async function finish(jobs: SettingsImportJobs): Promise<GroupImportJob> {
  for (let i = 0; i < 300; i++) {
    const current = jobs.current() as GroupImportJob;
    if (!["running", "cancelling"].includes(current.state)) return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("fixture job did not finish");
}
const fixture = () => createFixture(dirs, sourceHandles);
async function pinned(data: ReturnType<typeof fixture>, host: ImportHost, cutoff = 1000) {
  const path = host === "pi" ? data.pi : host === "opencode" ? data.dbPath : data.claude;
  const source = validateImportSource(host, path).sourceToken;
  const identity = readImportSourceToken(source, host);
  const match = { host, scope: "all-projects" as const, pathMaps: [], cwd: data.project };
  const sessions = await matchImportSessions(identity, match, "fresh");
  return {
    host,
    source,
    selection: { mode: "all", revision: sessions.revision, excludedKeys: [], listedAt: cutoff },
    modelChoice: "external",
  };
}

it("reads all host fixtures with pinned cutoffs and private/trivial filtering, without writes", async () => {
  const data = fixture();
  const hosts = await Promise.all(
    (["pi", "opencode", "claude-code"] as const).map((host) => pinned(data, host, 35))
  );
  const before = data.files.map(hash);
  const jobs = new SettingsImportJobs({ readiness: ready });
  await jobs.start(
    { hosts, options: { dryRun: true, scope: "all-projects", profileBatch: 2 } },
    data.project
  );
  const result = await finish(jobs);
  expect(result.state).toBe("done");
  expect(result.hosts.map((row) => row.summary?.unitsHeldBack)).toEqual([2, 2, 2]);
  expect(result.hosts.map((row) => row.summary?.profile?.promptsWouldRecord)).toEqual([2, 2, 2]);
  expect(result.profileEstimate).toEqual({
    historyPrompts: 1,
    waitingPrompts: 0,
    totalPrompts: 1,
    analysisCalls: 1,
  });
  expect(result.hosts.map((row) => row.profileEstimate?.totalPrompts)).toEqual([1, 1, 1]);
  expect(result.hosts.every((row) => row.blocker?.includes("key is missing"))).toBe(true);
  expect(data.files.map(hash)).toEqual(before);
  expect(existsSync(CONFIG.storagePath)).toBe(false);
  expect(readdirSync(data.root).sort()).toEqual([
    "claude",
    "opencode.db",
    "opencode.db-shm",
    "opencode.db-wal",
    "pi",
    "project",
  ]);
  expect(JSON.stringify(result)).not.toContain("Synthetic response");
  expect(JSON.stringify(result)).not.toContain("Never disclose");
  const identity = readImportSourceToken(hosts[1]!.source, "opencode");
  const lease = await opencodeSnapshots.acquire(importSourceKey(identity), data.dbPath, "reuse");
  await lease.release();
});

it("rejects an actual queued folder replacement before constructing its model or running it", async () => {
  const data = fixture();
  const hosts = await Promise.all(
    (["pi", "claude-code"] as const).map((host) => pinned(data, host))
  );
  const before = data.files.map(hash);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const models: string[] = [];
  const called: string[] = [];
  const jobs = new SettingsImportJobs({
    readiness: async () => ({
      ...(await ready()),
      external: { state: "ready", provider: "test", model: "test" },
    }),
    prepareModels: async (_choice, _directory, _signal, host) => {
      models.push(host);
      return {};
    },
    runner: async (host) => {
      called.push(host);
      if (host === "pi") {
        started();
        await gate;
      }
      return completedReport();
    },
  });
  await jobs.start({ hosts, options: { scope: "all-projects", skipProfile: true } }, data.project);
  await entered;
  try {
    expect(jobs.current()).toMatchObject({
      activeHost: "pi",
      hosts: [{ state: "running" }, { state: "queued" }],
    });
    const previous = join(data.root, "claude-previous");
    renameSync(data.claude, previous);
    mkdirSync(data.claude);
    renameSync(join(previous, "project"), join(data.claude, "project"));
    expect(validateImportSource("claude-code", data.claude).sourceToken).not.toBe(hosts[1]!.source);
  } finally {
    release();
  }
  const result = await finish(jobs);
  expect(result).toMatchObject({
    state: "failed",
    summary: { unitsImported: 1 },
    hosts: [
      { state: "done", summary: { unitsImported: 1 } },
      { state: "failed", error: "Claude Code: The history source changed. Choose it again." },
    ],
  });
  expect(models).toEqual(["pi"]);
  expect(called).toEqual(["pi"]);
  expect(data.files.map(hash)).toEqual(before);
  expect(existsSync(CONFIG.storagePath)).toBe(false);
});

it("unions a persisted waiting backlog with all real histories once without changing any bytes", async () => {
  const data = fixture();
  mkdirSync(CONFIG.storagePath);
  const path = join(CONFIG.storagePath, "user-prompts.db");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE user_prompts (session_id TEXT, message_id TEXT, content TEXT, user_learning_captured INTEGER)"
  );
  const insert = db.prepare("INSERT INTO user_prompts VALUES (?, ?, ?, ?)");
  insert.run("same", "u0", "Please improve the regression tests", 0);
  insert.run("waiting", "u", "Prefer concise explanations", 0);
  insert.run("same", "u1", "yes", 0);
  insert.run("same", "u2", "<private>confidential input</private>", 0);
  insert.run("learned", "u", "use bun not npm", 1);
  db.close();
  const hosts = await Promise.all(
    (["pi", "opencode", "claude-code"] as const).map((host) => pinned(data, host))
  );
  const files = [...data.files, path];
  const before = files.map(hash);
  const jobs = new SettingsImportJobs({
    readiness: ready,
    prepareModels: async () => {
      throw new Error("preview must not prepare a model");
    },
  });
  await jobs.start(
    { hosts, options: { dryRun: true, scope: "all-projects", profileBatch: 2 } },
    data.project
  );
  const result = await finish(jobs);
  expect(result).toMatchObject({
    state: "done",
    summary: { unitsWouldImport: 12, profile: { promptsWouldRecord: 9 } },
    profileEstimate: { historyPrompts: 1, waitingPrompts: 2, totalPrompts: 3, analysisCalls: 2 },
  });
  expect(result.hosts.map((row) => row.profileEstimate)).toEqual(
    Array.from({ length: 3 }, () => ({
      historyPrompts: 1,
      waitingPrompts: 2,
      totalPrompts: 3,
      analysisCalls: 2,
    }))
  );
  await tursoConnectionManager.closeAll();
  expect(files.map(hash)).toEqual(before);
  expect(readdirSync(CONFIG.storagePath)).toEqual(["user-prompts.db"]);
  expect(JSON.stringify(result)).not.toContain("confidential input");
  expect(JSON.stringify(result)).not.toContain("Prefer concise explanations");
  expect(JSON.stringify(result)).not.toContain("Please improve the regression tests");
});

it("fresh grouped previews reuse done/failed and once-only forced ledger identities without changing the ledger", async () => {
  const data = fixture();
  mkdirSync(CONFIG.storagePath);
  const ledgerPath = join(CONFIG.storagePath, "import-ledger.db");
  const ledger = new DatabaseSync(ledgerPath);
  ledger.exec(
    "CREATE TABLE import_ledger (key TEXT PRIMARY KEY, session_id TEXT, source_file TEXT, project_hash TEXT, status TEXT, memory_id TEXT, skip_reason TEXT, updated_at INTEGER)"
  );
  const insert = ledger.prepare(
    "INSERT INTO import_ledger VALUES (?, 'same', '', 'profile', ?, NULL, NULL, 1)"
  );
  for (const index of [0, 1, 3]) {
    insert.run(`pi:same:u${index}:a${index}`, "imported");
    insert.run(`pi:same:u${index}:a${index}#profile`, "imported");
    insert.run(`pi:same:u${index}:a${index}#profile-rebuild`, "imported");
  }
  insert.run("pi:same:u2:a2", "imported");
  insert.run("opencode:same:u0:a0", "failed");
  ledger.close();
  const before = hash(ledgerPath);
  const hosts = await Promise.all(
    (["pi", "opencode", "claude-code"] as const).map((host) => pinned(data, host))
  );
  const jobs = new SettingsImportJobs({ readiness: ready });
  await jobs.start(
    { hosts, options: { dryRun: true, scope: "all-projects", skipProfile: true } },
    data.project
  );
  const memories = await finish(jobs);
  expect(memories.state).toBe("done");
  expect(memories.hosts[0]).toMatchObject({
    state: "no-work",
    summary: { unitsAlreadyHandled: 4, unitsWouldImport: 0 },
  });
  expect(memories.hosts.slice(1).map((row) => row.summary?.unitsWouldImport)).toEqual([4, 4]);
  expect(memories.hosts[1]!.summary?.unitsAlreadyHandled).toBe(0);
  await jobs.start(
    { hosts, options: { dryRun: true, scope: "all-projects", skipMemories: true, force: true } },
    data.project
  );
  const result = await finish(jobs);
  expect(result.state).toBe("done");
  expect(result.hosts[0]).toMatchObject({
    state: "no-work",
    summary: { profile: { promptsWouldRecord: 0, promptsAlreadyHandled: 3 } },
  });
  expect(result.hosts.slice(1).map((row) => row.summary?.profile?.promptsWouldRecord)).toEqual([
    3, 3,
  ]);
  expect(result.profileEstimate?.totalPrompts).toBe(2);
  expect(result.summary?.profile?.promptsAlreadyHandled).toBe(3);
  await tursoConnectionManager.closeAll();
  expect(hash(ledgerPath)).toBe(before);
  expect(new SettingsImportJobs({ readiness: ready }).current()).toBeNull();
});

it("reads waiting prompts without initialising stores, filters private/trivial input and leaves backlog intact", async () => {
  fixture();
  expect(await readWaitingProfilePrompts()).toEqual(new Set());
  expect(existsSync(CONFIG.storagePath)).toBe(false);
  mkdirSync(CONFIG.storagePath);
  const path = join(CONFIG.storagePath, "user-prompts.db");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE user_prompts (session_id TEXT, message_id TEXT, content TEXT, user_learning_captured INTEGER)"
  );
  const insert = db.prepare("INSERT INTO user_prompts VALUES (?, ?, ?, ?)");
  insert.run("same", "u0", "Please improve the regression tests", 0);
  insert.run("same", "u1", "yes", 0);
  insert.run("same", "u2", "<private>confidential input</private>", 0);
  insert.run("learned", "u", "use bun not npm", 1);
  db.close();
  const before = hash(path);
  expect(await readWaitingProfilePrompts()).toEqual(new Set([JSON.stringify(["same", "u0"])]));
  await tursoConnectionManager.closeAll();
  expect(hash(path)).toBe(before);
});

it("supports valid zero-session grouped sources and honours abort before resolving a source", async () => {
  const data = fixture();
  const host = await pinned(data, "claude-code");
  const controller = new AbortController();
  controller.abort();
  await expect(
    resolveImportSelection(host.source, host.selection as never, {
      host: "claude-code",
      scope: "all-projects",
      pathMaps: [],
      cwd: data.project,
      signal: controller.signal,
    })
  ).rejects.toThrow();
  const empty = join(data.root, "empty");
  mkdirSync(empty);
  const source = validateImportSource("claude-code", empty).sourceToken;
  const identity = readImportSourceToken(source, "claude-code");
  const match = {
    host: "claude-code" as const,
    scope: "all-projects" as const,
    pathMaps: [],
    cwd: data.project,
  };
  const listed = await matchImportSessions(identity, match, "fresh");
  const jobs = new SettingsImportJobs({ readiness: ready });
  await jobs.start(
    {
      hosts: [
        {
          host: "claude-code",
          source,
          selection: { ...host.selection, revision: listed.revision },
        },
      ],
      options: { dryRun: true, scope: "all-projects" },
    },
    data.project
  );
  const result = await finish(jobs);
  expect(result).toMatchObject({
    state: "done",
    sessions: 0,
    summary: { unitsWouldImport: 0 },
    profileEstimate: { historyPrompts: 0, waitingPrompts: 0, totalPrompts: 0, analysisCalls: 0 },
    hosts: [{ state: "no-work" }],
  });
});

it("honours an existing host claim and keeps its owner unchanged when the queued child is refused", async () => {
  const data = fixture();
  const { tryAcquireBackfillLock } = await import("../src/importer/backfill-lock.js");
  const { runHistoryImport } = await import("../src/importer/run-import.js");
  const release = await tryAcquireBackfillLock("opencode");
  expect(release).not.toBeNull();
  const db = await tursoConnectionManager.getConnection(
    join(CONFIG.storagePath, "import-ledger.db")
  );
  const before = await db.get("SELECT * FROM backfill_locks WHERE host = 'opencode'");
  const hosts = await Promise.all(
    (["pi", "opencode", "claude-code"] as const).map((host) => pinned(data, host))
  );
  const called: string[] = [];
  const jobs = new SettingsImportJobs({
    readiness: async () => ({
      ...(await ready()),
      external: { state: "ready", provider: "test", model: "test" },
    }),
    prepareModels: async () => ({}),
    runner: async (host, args, run) => {
      called.push(host);
      if (host === "opencode") return runHistoryImport(host, args, run);
      return completedReport();
    },
  });
  try {
    await jobs.start(
      { hosts, options: { scope: "all-projects", skipProfile: true } },
      data.project
    );
    const result = await finish(jobs);
    expect(result).toMatchObject({
      state: "failed",
      hosts: [
        { state: "done" },
        {
          state: "failed",
          error: expect.stringContaining("An OpenCode import is already running"),
        },
        { state: "not-run" },
      ],
    });
    expect(called).toEqual(["pi", "opencode"]);
    expect(await db.get("SELECT * FROM backfill_locks WHERE host = 'opencode'")).toEqual(before);
    const identity = readImportSourceToken(hosts[1]!.source, "opencode");
    await expect(
      opencodeSnapshots.acquire(importSourceKey(identity), data.dbPath, "reuse")
    ).rejects.toMatchObject({ code: "expired" });
  } finally {
    await release?.();
  }
});
