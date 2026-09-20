import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  legacyMigrationPaths,
  readLegacyMigrationMarker,
  resolveDefaultStoragePath,
  runLegacyStoreMigration,
} from "../src/services/legacy-migration.js";

const tempDirs: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "omms-migration-test-"));
  tempDirs.push(home);
  return home;
}

function bytes(n: number): Buffer {
  return Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + 7) % 251));
}

/**
 * Build a realistic legacy layout: store files under data/, plus log and
 * config artefacts at the legacy root that must be backed up but not copied
 * into the new store.
 */
function seedLegacyStore(home: string): void {
  const paths = legacyMigrationPaths(home);
  mkdirSync(join(paths.legacyDataDir, "shards"), { recursive: true });
  mkdirSync(join(paths.legacyDataDir, "empty-dir"), { recursive: true });
  mkdirSync(join(paths.legacyDataDir, "nested", "deep"), { recursive: true });
  writeFileSync(join(paths.legacyDataDir, "global.sqlite"), bytes(2048));
  writeFileSync(join(paths.legacyDataDir, "shards", "shard-001.sqlite"), bytes(4096));
  writeFileSync(join(paths.legacyDataDir, "import-ledger.db"), bytes(512));
  writeFileSync(join(paths.legacyDataDir, "nested", "deep", "meta.json"), bytes(64));
  writeFileSync(join(paths.legacyDir, "opencode-mem.log"), bytes(128));
  writeFileSync(join(paths.legacyDir, "notes.txt"), bytes(32));
}

interface TreeSnapshot {
  files: Map<string, string>;
}

function snapshotTree(root: string): TreeSnapshot {
  const files = new Map<string, string>();
  const visit = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(join(dir, entry.name), childRel);
      } else {
        files.set(
          childRel,
          createHash("sha256")
            .update(readFileSync(join(dir, entry.name)))
            .digest("hex")
        );
      }
    }
  };
  visit(root, "");
  return { files };
}

function expectTreeMatches(sourceRoot: string, destRoot: string): void {
  const source = snapshotTree(sourceRoot);
  const dest = snapshotTree(destRoot);
  expect(dest.files.size).toBe(source.files.size);
  for (const [rel, hash] of source.files) {
    expect(dest.files.get(rel)).toBe(hash);
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("legacy store migration", () => {
  it("migrates a legacy layout with verified checksums, marker, and untouched original", () => {
    const home = makeHome();
    seedLegacyStore(home);
    const paths = legacyMigrationPaths(home);
    const before = snapshotTree(paths.legacyDir);

    const result = runLegacyStoreMigration(home);

    expect(result.kind).toBe("migrated");
    // Store contents copied to the omms data dir, byte-for-byte.
    expectTreeMatches(paths.legacyDataDir, paths.ommsDataDir);
    // Legacy directory is byte-for-byte unchanged.
    expect(snapshotTree(paths.legacyDir)).toEqual(before);
    // Marker records source, destination, backup path, file count, timestamp.
    const marker = readLegacyMigrationMarker(home);
    expect(marker?.status).toBe("migrated");
    expect(marker?.source).toBe(paths.legacyDataDir);
    expect(marker?.destination).toBe(paths.ommsDataDir);
    expect(marker?.backupPath).toContain(join(paths.backupsDir, "opencode-mem-"));
    expect(marker?.fileCount).toBe(4);
    expect(typeof marker?.startedAt).toBe("string");
    expect(typeof marker?.completedAt).toBe("string");
    // Backup covers the ENTIRE legacy directory (store plus root artefacts);
    // manifest.json (written after the backup copy) is the only addition.
    const backupRoot = marker!.backupPath!;
    const backupFiles = snapshotTree(backupRoot).files;
    backupFiles.delete("manifest.json");
    expect(backupFiles.size).toBe(before.files.size);
    for (const [rel, hash] of before.files) {
      expect(backupFiles.get(rel)).toBe(hash);
    }
    const manifest = JSON.parse(readFileSync(join(backupRoot, "manifest.json"), "utf-8")) as {
      source: string;
      fileCount: number;
      files: Array<{ path: string; size: number; sha256: string }>;
    };
    expect(manifest.source).toBe(paths.legacyDir);
    expect(manifest.fileCount).toBe(6);
    for (const entry of manifest.files) {
      const hash = createHash("sha256")
        .update(readFileSync(join(backupRoot, entry.path)))
        .digest("hex");
      expect(hash).toBe(entry.sha256);
    }
    // Storage default resolves to the omms layout after success.
    expect(resolveDefaultStoragePath(home)).toBe(paths.ommsDataDir);
  });

  it("is idempotent: a rerun with the marker present is a no-op", () => {
    const home = makeHome();
    seedLegacyStore(home);
    const paths = legacyMigrationPaths(home);
    runLegacyStoreMigration(home);
    const markerBefore = readFileSync(paths.markerPath, "utf-8");
    const backupsBefore = fs.readdirSync(paths.backupsDir);

    const result = runLegacyStoreMigration(home);

    expect(result.kind).toBe("already-migrated");
    expect(readFileSync(paths.markerPath, "utf-8")).toBe(markerBefore);
    expect(fs.readdirSync(paths.backupsDir)).toEqual(backupsBefore);
  });

  it("aborts with a failed marker and nothing migrated when the backup cannot be created", () => {
    const home = makeHome();
    seedLegacyStore(home);
    const paths = legacyMigrationPaths(home);
    // Block the backup destination by making the backups path a regular file.
    mkdirSync(paths.ommsDir, { recursive: true });
    writeFileSync(paths.backupsDir, "not a directory", "utf-8");
    const before = snapshotTree(paths.legacyDir);

    const result = runLegacyStoreMigration(home);

    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.marker.status).toBe("failed");
    expect(result.kind === "failed" && result.marker.stage).toBe("backup");
    expect(readLegacyMigrationMarker(home)?.status).toBe("failed");
    // Nothing was migrated and the legacy directory is untouched.
    expect(fs.existsSync(paths.ommsDataDir)).toBe(false);
    expect(snapshotTree(paths.legacyDir)).toEqual(before);
    // Storage keeps resolving to the legacy layout.
    expect(resolveDefaultStoragePath(home)).toBe(paths.legacyDataDir);
  });

  it("aborts and removes the partial destination when a copied file fails verification", () => {
    const home = makeHome();
    seedLegacyStore(home);
    const paths = legacyMigrationPaths(home);
    const before = snapshotTree(paths.legacyDir);

    const realCopy = fs.copyFileSync;
    const copySpy = spyOn(fs, "copyFileSync").mockImplementation(((
      source: fs.PathLike,
      dest: fs.PathLike
    ) => {
      realCopy(source, dest);
      // Corrupt only the STORE copy (destination under the omms data dir);
      // the backup copy must stay clean so the failure is attributed to the
      // copy stage, exactly like real mid-copy corruption would be.
      if (String(source).endsWith("shard-001.sqlite") && String(dest).includes(paths.ommsDataDir)) {
        fs.appendFileSync(dest, "corruption");
      }
    }) as typeof fs.copyFileSync);

    const result = runLegacyStoreMigration(home);
    copySpy.mockRestore();

    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.marker.stage).toBe("copy");
    expect(readLegacyMigrationMarker(home)?.status).toBe("failed");
    // The partial destination is removed so an explicit retry can proceed.
    expect(fs.existsSync(paths.ommsDataDir)).toBe(false);
    expect(snapshotTree(paths.legacyDir)).toEqual(before);
    // The backup completed before the copy stage and stays usable.
    const marker = readLegacyMigrationMarker(home);
    expect(fs.existsSync(marker!.backupPath!)).toBe(true);
    expect(resolveDefaultStoragePath(home)).toBe(paths.legacyDataDir);
  });

  it("treats a corrupt marker as absent and retries the migration", () => {
    const home = makeHome();
    seedLegacyStore(home);
    const paths = legacyMigrationPaths(home);
    mkdirSync(paths.ommsDir, { recursive: true });
    writeFileSync(paths.markerPath, "{not json", "utf-8");

    const result = runLegacyStoreMigration(home);

    expect(result.kind).toBe("migrated");
    expect(readLegacyMigrationMarker(home)?.status).toBe("migrated");
    expect(resolveDefaultStoragePath(home)).toBe(paths.ommsDataDir);
  });

  it("starts directly at the new paths on a fresh install with no migration artefacts", () => {
    const home = makeHome();

    const result = runLegacyStoreMigration(home);

    expect(result.kind).toBe("fresh");
    const paths = legacyMigrationPaths(home);
    expect(fs.existsSync(paths.markerPath)).toBe(false);
    expect(fs.existsSync(paths.backupsDir)).toBe(false);
    expect(resolveDefaultStoragePath(home)).toBe(paths.ommsDataDir);
  });

  it("never overwrites an existing omms data directory without a marker", () => {
    const home = makeHome();
    seedLegacyStore(home);
    const paths = legacyMigrationPaths(home);
    mkdirSync(paths.ommsDataDir, { recursive: true });
    writeFileSync(join(paths.ommsDataDir, "existing.txt"), "pre-existing", "utf-8");
    const before = snapshotTree(paths.legacyDir);

    const result = runLegacyStoreMigration(home);

    expect(result.kind).toBe("destination-exists");
    expect(readFileSync(join(paths.ommsDataDir, "existing.txt"), "utf-8")).toBe("pre-existing");
    expect(fs.existsSync(paths.markerPath)).toBe(false);
    expect(snapshotTree(paths.legacyDir)).toEqual(before);
    // Storage resolution stays conservative: the legacy layout remains in use.
    expect(resolveDefaultStoragePath(home)).toBe(paths.legacyDataDir);
  });

  it("defers to a live migration lock holder and takes over a stale lock", () => {
    const home = makeHome();
    seedLegacyStore(home);
    const paths = legacyMigrationPaths(home);
    mkdirSync(paths.ommsDir, { recursive: true });
    // Live holder (this process): the migration defers.
    writeFileSync(paths.lockPath, JSON.stringify({ pid: process.pid }), "utf-8");
    expect(runLegacyStoreMigration(home).kind).toBe("in-progress");
    expect(fs.existsSync(paths.ommsDataDir)).toBe(false);

    // Stale holder (dead pid 4000000 cannot exist): the lock is taken over.
    writeFileSync(paths.lockPath, JSON.stringify({ pid: 4000000 }), "utf-8");
    const result = runLegacyStoreMigration(home);
    expect(result.kind).toBe("migrated");
    expect(fs.existsSync(paths.lockPath)).toBe(false);
    expect(readLegacyMigrationMarker(home)?.status).toBe("migrated");
  });
});
