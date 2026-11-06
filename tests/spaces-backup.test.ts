import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupSpace, readBackupManifest } from "../src/services/spaces/backup.js";

let root: string;
let folder: string;
let backups: string;
const space = { id: "experiments", name: "Experiments" };
const input = () => ({ space, spaceFolder: folder, backupsRoot: backups, ommsVersion: "9.9.9" });

async function makeDb(path: string, rows: number) {
  const client = createClient({ url: `file:${path}` });
  await client.execute("CREATE TABLE IF NOT EXISTS t (n INTEGER)");
  for (let i = 0; i < rows; i++)
    await client.execute({ sql: "INSERT INTO t VALUES (?)", args: [i] });
  return client;
}

async function countRows(path: string): Promise<{ rows: number; integrity: string }> {
  const client = createClient({ url: `file:${path}` });
  try {
    const rows = Number((await client.execute("SELECT COUNT(*) AS c FROM t")).rows[0]!.c);
    const integrity = String((await client.execute("PRAGMA integrity_check")).rows[0]![0]);
    return { rows, integrity };
  } finally {
    client.close();
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omms-space-backup-"));
  folder = join(root, "spaces", "experiments");
  backups = join(root, "backups");
  mkdirSync(join(folder, "projects"), { recursive: true });
  mkdirSync(join(folder, ".cache"), { recursive: true });
  mkdirSync(join(folder, ".write-locks"), { recursive: true });
  (await makeDb(join(folder, "metadata.db"), 3)).close();
  (await makeDb(join(folder, "projects", "shard.db"), 5)).close();
  writeFileSync(join(folder, "cold-buffer.json"), '{"p":1}');
  writeFileSync(join(folder, ".cache", "model.bin"), "big model file");
  writeFileSync(join(folder, "metadata.db-journal"), "half written");
  writeFileSync(join(folder, ".write-locks", "x.lock"), "lock");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("backupSpace", () => {
  it("copies the store files, skips the model cache, lock files and SQLite journals, and writes a manifest", async () => {
    const { backupPath, manifest } = await backupSpace(input());
    expect(backupPath.startsWith(join(backups, "space-experiments-"))).toBe(true);
    expect(readFileSync(join(backupPath, "cold-buffer.json"), "utf-8")).toBe('{"p":1}');
    expect((await countRows(join(backupPath, "projects", "shard.db"))).rows).toBe(5);
    expect(readdirSync(backupPath).sort()).toEqual([
      "cold-buffer.json",
      "manifest.json",
      "metadata.db",
      "projects",
    ]);
    expect(manifest.files.map((f) => f.path).sort()).toEqual([
      "cold-buffer.json",
      "metadata.db",
      "projects/shard.db",
    ]);
  });

  it("records the space id, name and OMMS version in the manifest", async () => {
    const { backupPath } = await backupSpace(input());
    const manifest = readBackupManifest(backupPath);
    expect(manifest).toMatchObject({
      kind: "space-backup",
      spaceId: "experiments",
      spaceName: "Experiments",
      ommsVersion: "9.9.9",
      fileCount: 3,
    });
    expect(Number.isNaN(Date.parse(manifest.createdAt))).toBe(false);
  });

  it("gives a consistent copy while another connection writes", async () => {
    const path = join(folder, "metadata.db");
    const writer = createClient({ url: `file:${path}` });
    let stop = false;
    let written = 0;
    const loop = (async () => {
      while (!stop) {
        await writer.execute({ sql: "INSERT INTO t VALUES (?)", args: [written++] });
        // Let timers and the backup run between writes.
        await new Promise((done) => setImmediate(done));
      }
    })();
    await new Promise((done) => setTimeout(done, 30));
    const { backupPath } = await backupSpace(input());
    stop = true;
    await loop;
    writer.close();
    const copy = await countRows(join(backupPath, "metadata.db"));
    expect(copy.integrity).toBe("ok");
    expect(copy.rows).toBeGreaterThanOrEqual(3);
    expect(copy.rows).toBeLessThanOrEqual(3 + written);
  });

  it("fails, names the file and leaves no folder when a copy does not match its checksum", async () => {
    const deps = {
      copyFile: (source: string, destination: string) => {
        writeFileSync(destination, `${readFileSync(source, "utf-8")} damaged`);
      },
    };
    await expect(backupSpace(input(), deps)).rejects.toThrow(/cold-buffer\.json/);
    expect(readdirSync(backups)).toEqual([]);
  });

  it("leaves no folder when a database cannot be copied", async () => {
    const deps = {
      vacuumInto: async () => {
        throw new Error("disk full");
      },
    };
    await expect(backupSpace(input(), deps)).rejects.toThrow(/disk full/);
    expect(readdirSync(backups)).toEqual([]);
  });

  it("does not change the space folder", async () => {
    const before = readFileSync(join(folder, "cold-buffer.json"), "utf-8");
    await backupSpace(input());
    expect(readFileSync(join(folder, "cold-buffer.json"), "utf-8")).toBe(before);
    expect((await countRows(join(folder, "metadata.db"))).rows).toBe(3);
  });

  it("gives two backups taken in the same second different folders", async () => {
    const first = await backupSpace(input());
    const second = await backupSpace(input());
    expect(second.backupPath).not.toBe(first.backupPath);
  });
});
