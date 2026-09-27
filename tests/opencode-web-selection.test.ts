import { afterEach, expect, it, mock, setDefaultTimeout } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "./turso-test-utils.js";

setDefaultTimeout(30_000);
const dirs: string[] = [];
afterEach(async () => {
  const { opencodeSnapshots } = await import("../src/importer/opencode-snapshot.js");
  await opencodeSnapshots.closeAll();
  const { memoryClient } = await import("../src/services/client.js");
  await memoryClient.close();
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  await tursoConnectionManager.closeAll();
  for (const dir of dirs.splice(0)) await removeTestDir(dir);
});
const embeddingStub = {
  embedWithTimeout: async () => new Float32Array([0.25, 0.5, 0.75, 1]),
  warmup: async () => {},
  isWarmedUp: true,
};
mock.module("../src/services/embedding.js", () => ({
  embeddingService: embeddingStub,
  EmbeddingService: class {
    static getInstance() {
      return embeddingStub;
    }
  },
  applyEmbeddingTaskPrefix: (_model: unknown, text: string) => text,
  loadLocalTransformersBackend: async () => null,
}));
mock.module("../src/services/turso/ready.js", () => ({
  ensureTursoReady: async () => {},
  resetTursoReady: () => {},
}));
mock.module("../src/services/logger.js", () => ({ log: () => {} }));

function project(root: string, name: string) {
  const dir = join(root, name);
  mkdirSync(dir);
  const result = spawnSync("git", ["init", "-q"], { cwd: dir });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return dir;
}

/** A live OpenCode database: WAL mode with a writer that stays open, like OpenCode itself. */
function liveDatabase() {
  const root = mkdtempSync(join(tmpdir(), "omms-oc-web-"));
  dirs.push(root);
  const projectA = project(root, "a");
  const dbPath = join(root, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE project (id TEXT, worktree TEXT);
    CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER);
    CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  db.prepare("INSERT INTO project VALUES (?, ?)").run("p", projectA);
  const session = (id: string, at: number) =>
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run(id, "p", null, projectA, at);
  const turn = (sessionId: string, id: string, at: number, text: string) => {
    for (const [suffix, role, body, time] of [
      ["u", "user", text, at],
      ["a", "assistant", "done", at + 1],
    ] as const) {
      db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
        id + suffix,
        sessionId,
        time,
        JSON.stringify({ role })
      );
      db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run(
        `${id}${suffix}-0`,
        id + suffix,
        sessionId,
        time,
        JSON.stringify({ type: "text", text: body })
      );
    }
  };
  session("s1", 10);
  turn("s1", "t1", 11, "First turn");
  return { root, projectA, dbPath, db, session, turn };
}

const checksum = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const ownedSnapshots = () =>
  readdirSync(tmpdir()).filter((name) => {
    if (!name.startsWith("omms-opencode-")) return false;
    try {
      const owner = JSON.parse(readFileSync(join(tmpdir(), name, "owner.json"), "utf8"));
      return owner.pid === process.pid;
    } catch {
      return false;
    }
  });

it("pins the session set, holds back newer turns, copies once, and leaves the source unchanged", async () => {
  const live = liveDatabase();
  try {
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = join(live.root, "store");
    CONFIG.embeddingDimensions = 4;
    const { validateImportSource } = await import("../src/importer/import-sources.js");
    const { listImportSessions, resolveImportSelection } =
      await import("../src/importer/import-sessions.js");
    const { runHistoryImport } = await import("../src/importer/run-import.js");
    const { importSourceKey, readImportSourceToken } =
      await import("../src/importer/import-sources.js");

    const source = validateImportSource("opencode", live.dbPath);
    expect(source.kind).toBe("opencode-db");
    const match = {
      host: "opencode" as const,
      scope: "all-projects" as const,
      pathMaps: [],
      cwd: live.projectA,
    };
    const list = await listImportSessions(
      { sourceToken: source.sourceToken, refresh: true },
      match
    );
    expect(list.rows.map((row) => [row.key, row.via])).toEqual([["s1", "recorded"]]);
    expect(JSON.stringify(list)).not.toContain("First turn");
    const copies = ownedSnapshots();
    expect(copies).toHaveLength(1);

    // A new turn after listing keeps the revision; the preview holds it back.
    live.turn("s1", "t2", Date.now() + 60_000, "After listing");
    const again = await listImportSessions(
      { sourceToken: source.sourceToken, refresh: true },
      match
    );
    expect(again.revision).toBe(list.revision);
    const selection = await resolveImportSelection(
      source.sourceToken,
      { mode: "all", excludedKeys: [], revision: again.revision, listedAt: again.listedAt },
      match
    );
    const snapshotKey = importSourceKey(readImportSourceToken(source.sourceToken, "opencode"));
    const args = {
      help: false,
      dryRun: true,
      force: false,
      skipMemories: false,
      skipProfile: true,
      scope: "all-projects" as const,
      pathMaps: [],
      source: live.dbPath,
      errors: [],
    };
    const copiesBeforeJob = ownedSnapshots();
    const preview = await runHistoryImport("opencode", args, {
      cwd: live.projectA,
      models: {},
      selection: { keys: selection.keys, cutoff: selection.cutoff, snapshotKey },
    });
    expect(preview.unitsTotal).toBe(1);
    expect(preview.unitsHeldBack).toBe(1);
    // The job reused the listing's copy instead of copying again.
    expect(ownedSnapshots()).toEqual(copiesBeforeJob);

    // A new session changes the revision, so the old "all" selection is stale.
    live.session("s2", 20);
    live.turn("s2", "t3", 21, "New session");
    const fresh = await listImportSessions(
      { sourceToken: source.sourceToken, refresh: true },
      match
    );
    expect(fresh.revision).not.toBe(list.revision);
    await expect(
      resolveImportSelection(
        source.sourceToken,
        { mode: "all", excludedKeys: [], revision: list.revision, listedAt: list.listedAt },
        match
      )
    ).rejects.toMatchObject({ status: 409 });
    // Only the reads above touched the source; our own writer made these changes.
    live.db.close();
    const { opencodeSnapshots } = await import("../src/importer/opencode-snapshot.js");
    await opencodeSnapshots.closeAll();
    expect(ownedSnapshots()).toEqual([]);
  } finally {
    try {
      live.db.close();
    } catch {
      // Already closed.
    }
  }
});

it("never writes the source database, WAL, or SHM while listing and previewing", async () => {
  const live = liveDatabase();
  const sidecars = ["", "-wal", "-shm"].map((suffix) => live.dbPath + suffix);
  try {
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = join(live.root, "store");
    const { validateImportSource } = await import("../src/importer/import-sources.js");
    const { listImportSessions } = await import("../src/importer/import-sessions.js");
    const before = sidecars.map(checksum);
    const source = validateImportSource("opencode", live.dbPath);
    await listImportSessions(
      { sourceToken: source.sourceToken, refresh: true },
      { host: "opencode", scope: "all-projects", pathMaps: [], cwd: live.projectA }
    );
    expect(sidecars.map(checksum)).toEqual(before);
  } finally {
    live.db.close();
  }
});
