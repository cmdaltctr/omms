import { afterEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { cleanupTursoTestDirectory, removeTestDir } from "./turso-test-utils.js";

// Characterisation of the space store and the space backup snapshot (storage port, slice SP1).
// Each test pins today's behaviour through the public API, so the move into the port changes nothing.

const HASH = "a1b2c3d4e5f60718";
const TAG = `omms_project_${HASH}`;
const FIXED_NOW = new Date("2026-01-02T03:04:05.000Z");
/** SHA-256 of the canonical manifest of the fixed fixture below, recorded on the code before the move. */
const FIXTURE_MANIFEST_SHA256 = "7a22f7379ef53394a13df9cc4ef858da93c6d569ced00cb8316dfe8c3edeaf26";

const folders: string[] = [];

function tempFolder(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  folders.push(folder);
  return folder;
}

afterEach(async () => {
  const { closeAllCachedSpaceReadStores } =
    await import("../src/services/spaces/read-store-cache.js");
  await closeAllCachedSpaceReadStores();
  await cleanupTursoTestDirectory();
  for (const folder of folders.splice(0)) await removeTestDir(folder);
});

/** SHA-256 of every file under `folder`, keyed by its path relative to the folder. */
function hashFolder(folder: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else hashes.set(relative(folder, full), sha256(readFileSync(full)));
    }
  };
  walk(folder);
  return hashes;
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function makeTable(path: string, rows: number): Promise<void> {
  const client = createClient({ url: `file:${path}` });
  try {
    await client.execute("CREATE TABLE t (n INTEGER, label TEXT)");
    for (let i = 0; i < rows; i++) {
      await client.execute({ sql: "INSERT INTO t VALUES (?, ?)", args: [i, `row ${i}`] });
    }
  } finally {
    client.close();
  }
}

async function checkOf(path: string, pragma: "integrity_check" | "quick_check"): Promise<string[]> {
  const client = createClient({ url: `file:${path}` });
  try {
    return (await client.execute(`PRAGMA ${pragma}`)).rows.map((row) => String(row[0]));
  } finally {
    client.close();
  }
}

async function useFourDimensions(): Promise<void> {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.embeddingDimensions = 4;
}

/** Writes one memory into a space folder through a write store, as transfer and import do. */
async function writeMemory(folder: string, id: string): Promise<void> {
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const { openSpaceStore } = await import("../src/services/storage/space-store.js");
  const store = openSpaceStore(folder, "write");
  try {
    const shard = await store.shards.getWriteShard("project", HASH);
    const db = await store.connections.getConnection(shard.dbPath);
    await tursoVectorSearch.insertVector(db, {
      id,
      content: `memory of ${id}`,
      vector: new Float32Array([1, 0, 0, 0]),
      containerTag: TAG,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    await store.shards.incrementVectorCount(shard.id);
  } finally {
    await store.close();
  }
}

describe("space backup snapshot", () => {
  /** A fixed space folder: two SQLite files, one plain file, and files a backup must skip. */
  async function fixture(): Promise<string> {
    const folder = join(tempFolder("omms-sp1-fixture-"), "space");
    mkdirSync(join(folder, "projects"), { recursive: true });
    mkdirSync(join(folder, ".cache"), { recursive: true });
    await makeTable(join(folder, "metadata.db"), 3);
    await makeTable(join(folder, "projects", "shard.db"), 5);
    writeFileSync(join(folder, "cold-buffer.json"), '{"p":1}');
    writeFileSync(join(folder, ".cache", "model.bin"), "model");
    writeFileSync(join(folder, "metadata.db-journal"), "half written");
    return folder;
  }

  /** The manifest as written, with files in path order: the walk order differs per file system. */
  function canonicalManifest(backupPath: string): string {
    const manifest = JSON.parse(readFileSync(join(backupPath, "manifest.json"), "utf-8")) as {
      files: { path: string }[];
    };
    manifest.files.sort((a, b) => a.path.localeCompare(b.path));
    return JSON.stringify(manifest, null, 2);
  }

  it("writes the same files with the same manifest for a fixed fixture", async () => {
    const { backupSpace } = await import("../src/services/spaces/backup.js");
    const folder = await fixture();
    const backups = tempFolder("omms-sp1-backups-");
    const { backupPath, manifest } = await backupSpace({
      space: { id: "fixture", name: "Fixture" },
      spaceFolder: folder,
      backupsRoot: backups,
      ommsVersion: "9.9.9",
      now: FIXED_NOW,
    });

    expect(relative(backups, backupPath)).toBe("space-fixture-20260102T030405Z");
    expect(readdirSync(backupPath).sort()).toEqual([
      "cold-buffer.json",
      "manifest.json",
      "metadata.db",
      "projects",
    ]);
    expect(Object.keys(manifest)).toEqual([
      "createdAt",
      "kind",
      "spaceId",
      "spaceName",
      "ommsVersion",
      "fileCount",
      "files",
    ]);
    for (const file of manifest.files) {
      expect(Object.keys(file)).toEqual(["path", "size", "sha256"]);
      expect(sha256(readFileSync(join(backupPath, file.path)))).toBe(file.sha256);
    }
    expect(sha256(canonicalManifest(backupPath))).toBe(FIXTURE_MANIFEST_SHA256);
  });

  it("gives a copy that opens and passes integrity_check when taken mid-write", async () => {
    await useFourDimensions();
    const { backupSpace } = await import("../src/services/spaces/backup.js");
    const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
    const { openSpaceStore } = await import("../src/services/storage/space-store.js");
    const folder = tempFolder("omms-sp1-midwrite-");
    await writeMemory(folder, "seed");

    const writer = openSpaceStore(folder, "write");
    let stop = false;
    let written = 0;
    const loop = (async () => {
      const shard = await writer.shards.getWriteShard("project", HASH);
      const db = await writer.connections.getConnection(shard.dbPath);
      while (!stop) {
        await tursoVectorSearch.insertVector(db, {
          id: `busy_${written}`,
          content: `busy ${written}`,
          vector: new Float32Array([0, 1, 0, 0]),
          containerTag: TAG,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        written++;
        await writer.shards.incrementVectorCount(shard.id);
        // Let the backup run between writes.
        await new Promise((done) => setImmediate(done));
      }
    })();
    try {
      await new Promise((done) => setTimeout(done, 30));
      const { backupPath, manifest } = await backupSpace({
        space: { id: "busy", name: "Busy" },
        spaceFolder: folder,
        backupsRoot: tempFolder("omms-sp1-busy-backups-"),
        ommsVersion: "9.9.9",
      });
      stop = true;
      await loop;

      const databases = manifest.files.filter((file) => file.path.endsWith(".db"));
      expect(databases.length).toBeGreaterThanOrEqual(2);
      for (const file of databases) {
        const copy = join(backupPath, file.path);
        expect(await checkOf(copy, "quick_check")).toEqual(["ok"]);
        // Shard copies passed only quick_check before TDR-088.
        expect(await checkOf(copy, "integrity_check")).toEqual(["ok"]);
      }

      const copy = openSpaceStore(backupPath, "read");
      try {
        const shards = await copy.listShards("project", HASH);
        expect(shards).toHaveLength(1);
        const db = await copy.openShard(shards[0]!.dbPath);
        const count = Number((await db.get("SELECT COUNT(*) AS c FROM memories"))?.c);
        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(1 + written);
      } finally {
        await copy.close();
      }
    } finally {
      stop = true;
      await loop;
      await writer.close();
    }
  });
});

describe("linked space read store", () => {
  it("never writes to the linked folder while it lists, opens and reads", async () => {
    await useFourDimensions();
    const folder = tempFolder("omms-sp1-linked-");
    await writeMemory(folder, "linked_target");
    const before = hashFolder(folder);

    const { getCachedSpaceReadStore, closeCachedSpaceReadStore } =
      await import("../src/services/spaces/read-store-cache.js");
    const store = getCachedSpaceReadStore(folder);
    expect(store.mode).toBe("read");
    expect(store.hasMetadata).toBe(true);
    expect(await store.listShards("user", "")).toEqual([]);
    const shards = await store.listShards("project", "");
    expect(shards).toHaveLength(1);
    expect(relative(join(folder, "projects"), shards[0]!.dbPath)).not.toMatch(/[\\/]|^\.\./);
    const db = await store.openShard(shards[0]!.dbPath);
    const rows = await db.all("SELECT id FROM memories");
    expect(rows.map((row) => String(row.id))).toEqual(["linked_target"]);
    await expect(db.run("DELETE FROM memories")).rejects.toThrow();

    const missing = join(folder, "projects", "absent.db");
    await expect(store.openShard(missing)).rejects.toThrow(/missing/);
    expect(existsSync(missing)).toBe(false);

    await closeCachedSpaceReadStore(folder);
    expect(hashFolder(folder)).toEqual(before);
  });

  it("is dropped by a store-handle reset under its registered name, and reopens after", async () => {
    await useFourDimensions();
    const folder = tempFolder("omms-sp1-reset-");
    await writeMemory(folder, "before_reset");

    const { getCachedSpaceReadStore } = await import("../src/services/spaces/read-store-cache.js");
    const { registeredStoreResets, resetStoreHandles } =
      await import("../src/services/spaces/store-handles.js");
    expect(registeredStoreResets()).toContain("space-read-stores");

    const first = getCachedSpaceReadStore(folder);
    expect(getCachedSpaceReadStore(join(folder, "."))).toBe(first);
    await first.listShards("project", HASH);

    await resetStoreHandles();
    const second = getCachedSpaceReadStore(folder);
    expect(second).not.toBe(first);

    await writeMemory(folder, "after_reset");
    const [shard] = await second.listShards("project", HASH);
    const db = await second.openShard(shard!.dbPath);
    const ids = (await db.all("SELECT id FROM memories ORDER BY id")).map((row) => String(row.id));
    expect(ids).toEqual(["after_reset", "before_reset"]);
  });
});

describe("space store port paths", () => {
  it("serves the same store and snapshot through the old path and the port", async () => {
    const port = await import("../src/services/storage/space-store.js");
    const old = await import("../src/services/spaces/space-store.js");
    expect(old.openSpaceStore).toBe(port.openSpaceStore);

    const folder = tempFolder("omms-sp1-snapshot-");
    await makeTable(join(folder, "a.db"), 4);
    const { snapshotDatabase } = await import("../src/services/storage/snapshot.js");
    await snapshotDatabase(join(folder, "a.db"), join(folder, "b.db"));
    const client = createClient({ url: `file:${join(folder, "b.db")}` });
    try {
      const count = await client.execute("SELECT COUNT(*) AS c FROM t");
      expect(Number(count.rows[0]!.c)).toBe(4);
    } finally {
      client.close();
    }
  });
});
