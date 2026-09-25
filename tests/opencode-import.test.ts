import { afterEach, expect, it, mock, setDefaultTimeout } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(30_000);
const dirs: string[] = [];
afterEach(async () => {
  const { memoryClient } = await import("../src/services/client.js");
  await memoryClient.close();
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  await tursoConnectionManager.closeAll();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omms-oc-import-"));
  dirs.push(root);
  const project = join(root, "project");
  mkdirSync(project);
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "test@example.invalid"],
    ["config", "user.name", "Test User"],
  ]) {
    const result = spawnSync("git", args, { cwd: project });
    if (result.status !== 0) throw new Error(result.stderr.toString());
  }
  const dbPath = join(root, "history.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE project (id TEXT, worktree TEXT);
    CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER);
    CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  db.prepare("INSERT INTO project VALUES (?, ?)").run("p", project);
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("s", "p", null, project, 10);
  const add = (id: string, role: string, time: number, text: string) => {
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
      id,
      "s",
      time,
      JSON.stringify({ role })
    );
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run(
      `part-${id}`,
      id,
      "s",
      time,
      JSON.stringify({ type: "text", text })
    );
  };
  add("u1", "user", 11, "Fix importer");
  add("a1", "assistant", 12, "Fixed it");
  add("u2", "user", 21, "SKIPME casual chat");
  add("a2", "assistant", 22, "Hello");
  add("u3", "user", 31, "FAILME failing call");
  add("a3", "assistant", 32, "Tried fix");
  db.close();
  return { root, project, dbPath };
}

const checksum = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

it("filters before calls and imports, skips, retries, and reconciles by importId", async () => {
  const data = fixture();
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = join(data.root, "store");
  CONFIG.embeddingDimensions = 4;
  CONFIG.autoCaptureMaxContextBytes = 131072;
  const { importOpencodeHistory } = await import("../src/importer/opencode-import.js");
  const calls: string[] = [];
  const provider = {
    summarize: async ({ userPrompt }: { userPrompt: string }) => {
      calls.push(userPrompt);
      if (userPrompt.includes("FAILME")) throw new Error("offline");
      if (userPrompt.includes("SKIPME")) return { summary: "", type: "skip", tags: [] };
      return { summary: "Fixed importer", type: "feature", tags: ["import"] };
    },
  };
  const selected = await importOpencodeHistory({
    dbPath: data.dbPath,
    provider,
    skipProfile: true,
    since: 20,
    until: 22,
  });
  expect(selected.unitsTotal).toBe(1);
  expect(calls).toEqual(["SKIPME casual chat"]);
  const first = await importOpencodeHistory({ dbPath: data.dbPath, provider, skipProfile: true });
  expect(first.unitsImported).toBe(1);
  expect(first.unitsFailed).toBe(1);
  expect(first.unitsAlreadyHandled).toBe(1);
  expect(first.units.find((unit) => unit.status === "imported")?.key).toBe("opencode:s:u1:a1");
  const retry = await importOpencodeHistory({ dbPath: data.dbPath, provider, skipProfile: true });
  expect(retry.unitsAlreadyHandled).toBe(2);
  expect(retry.unitsFailed).toBe(1);
  const { memoryClient } = await import("../src/services/client.js");
  const { getTags } = await import("../src/services/tags.js");
  const list = await memoryClient.listMemories(getTags(data.project).project.tag, 10);
  expect(list.memories).toHaveLength(1);
});

it("previews exact work without writing a store or calling models", async () => {
  const data = fixture();
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = join(data.root, "empty-store");
  const { importOpencodeHistory } = await import("../src/importer/opencode-import.js");
  const before = checksum(data.dbPath);
  const report = await importOpencodeHistory({ dbPath: data.dbPath, dryRun: true });
  expect(report.unitsWouldImport).toBe(3);
  expect(report.profile?.promptsWouldRecord).toBe(3);
  expect(report.projects[0]?.units).toBe(3);
  expect(existsSync(CONFIG.storagePath)).toBe(false);
  expect(checksum(data.dbPath)).toBe(before);
});

it("reconciles a stored memory after a crash before the ledger update", async () => {
  const data = fixture();
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = join(data.root, "store");
  CONFIG.embeddingDimensions = 4;
  const { memoryClient } = await import("../src/services/client.js");
  const { getTags } = await import("../src/services/tags.js");
  const tag = getTags(data.project).project.tag;
  const { ImportLedger } = await import("../src/importer/ledger.js");
  await new ImportLedger().begin({
    key: "opencode:s:u1:a1",
    sessionId: "s",
    sourceFile: data.dbPath,
    projectHash: tag.split("_project_")[1]!,
  });
  const saved = await memoryClient.addMemory("Prior import", tag, {
    importId: "opencode:s:u1:a1",
    host: "opencode",
    sourceType: "history-import",
  });
  expect(saved.success).toBe(true);
  const { importOpencodeHistory } = await import("../src/importer/opencode-import.js");
  const calls: string[] = [];
  const report = await importOpencodeHistory({
    dbPath: data.dbPath,
    skipProfile: true,
    provider: {
      summarize: async ({ userPrompt }) => {
        calls.push(userPrompt);
        return { summary: "Another memory", type: "feature", tags: [] };
      },
    },
  });
  expect(report.units.find((unit) => unit.key === "opencode:s:u1:a1")?.reason).toBe("reconciled");
  expect(calls).not.toContain("Fix importer");
  const list = await memoryClient.listMemories(tag, 10);
  expect(list.memories).toHaveLength(3);
});

it("leaves a copied WAL database and sidecars byte-for-byte unchanged", async () => {
  const data = fixture();
  const writer = new DatabaseSync(data.dbPath);
  try {
    writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE);");
    writer.prepare("INSERT INTO project VALUES (?, ?)").run("extra", data.project);
    const copied = join(data.root, "copied.db");
    for (const suffix of ["", "-wal", "-shm"]) {
      expect(existsSync(data.dbPath + suffix)).toBe(true);
      copyFileSync(data.dbPath + suffix, copied + suffix);
    }
    const before = ["", "-wal", "-shm"].map((suffix) => checksum(copied + suffix));
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = join(data.root, "store");
    CONFIG.embeddingDimensions = 4;
    const { importOpencodeHistory } = await import("../src/importer/opencode-import.js");
    const result = await importOpencodeHistory({
      dbPath: copied,
      skipProfile: true,
      provider: { summarize: async () => ({ summary: "", type: "skip", tags: [] }) },
    });
    expect(result.unitsSkipped).toBe(3);
    expect(["", "-wal", "-shm"].map((suffix) => checksum(copied + suffix))).toEqual(before);
    const withoutShm = join(data.root, "without-shm.db");
    copyFileSync(data.dbPath, withoutShm);
    copyFileSync(data.dbPath + "-wal", withoutShm + "-wal");
    const beforeNoShm = [checksum(withoutShm), checksum(withoutShm + "-wal")];
    expect(existsSync(withoutShm + "-shm")).toBe(false);
    await importOpencodeHistory({ dbPath: withoutShm, dryRun: true });
    expect([checksum(withoutShm), checksum(withoutShm + "-wal")]).toEqual(beforeNoShm);
    expect(existsSync(withoutShm + "-shm")).toBe(false);
  } finally {
    writer.close();
  }
});

it("applies session, project and max-sessions filters before model calls", async () => {
  const data = fixture();
  const db = new DatabaseSync(data.dbPath);
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("s2", "p", null, data.project, 40);
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
    "u4",
    "s2",
    41,
    JSON.stringify({ role: "user" })
  );
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run(
    "part-u4",
    "u4",
    "s2",
    41,
    JSON.stringify({ type: "text", text: "Second session" })
  );
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
    "a4",
    "s2",
    42,
    JSON.stringify({ role: "assistant" })
  );
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run(
    "part-a4",
    "a4",
    "s2",
    42,
    JSON.stringify({ type: "text", text: "Done" })
  );
  db.close();
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = join(data.root, "store");
  CONFIG.embeddingDimensions = 4;
  const { importOpencodeHistory } = await import("../src/importer/opencode-import.js");
  const calls: string[] = [];
  const provider = {
    summarize: async ({ userPrompt }: { userPrompt: string }) => {
      calls.push(userPrompt);
      return { summary: "", type: "skip", tags: [] };
    },
  };
  const noSession = await importOpencodeHistory({
    dbPath: data.dbPath,
    session: "missing",
    provider,
    skipProfile: true,
  });
  expect(noSession.unitsTotal).toBe(0);
  const other = join(data.root, "different-project");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(other);
  const noProject = await importOpencodeHistory({
    dbPath: data.dbPath,
    project: other,
    provider,
    skipProfile: true,
  });
  expect(noProject.unitsTotal).toBe(0);
  expect(calls).toHaveLength(0);
  const limited = await importOpencodeHistory({
    dbPath: data.dbPath,
    maxSessions: 1,
    provider,
    skipProfile: true,
  });
  expect(limited.unitsTotal).toBe(3);
  expect(calls).toHaveLength(3);
  expect(calls).not.toContain("Second session");
});
