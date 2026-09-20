import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "./logger.js";

/**
 * One-time migration from the legacy opencode-mem layout to the omms layout.
 *
 * Safety rules (decision D13, in priority order):
 * 1. A timestamped, checksum-verified backup of the ENTIRE legacy directory
 *    is created before anything is copied. Backup failure aborts the
 *    migration; the system keeps resolving storage against the legacy layout.
 * 2. The store is COPIED to ~/.omms/data. The legacy directory is never
 *    moved, renamed, modified, or deleted.
 * 3. Every copied file is checksum-verified against its source. Any mismatch
 *    aborts and marks the migration failed.
 * 4. A marker file records source, destination, backup path, file count, and
 *    timestamp. Reruns with a marker present are no-ops (including failed
 *    markers: retry is an explicit operator action, documented in
 *    docs/omms-migration.md).
 * 5. Fresh installs (no legacy directory) start directly at the new paths.
 *
 * The opencode_ container tag prefix is untouched: it stays the on-disk
 * format so no memory row is rewritten by this migration.
 */

const LEGACY_DIR_NAME = ".opencode-mem";
const OMMS_DIR_NAME = ".omms";
const DATA_SUBDIR = "data";
const BACKUPS_SUBDIR = "backups";
const MARKER_FILE = "migration-marker.json";
const LOCK_FILE = ".legacy-migration.lock";
const MANIFEST_FILE = "manifest.json";

export interface LegacyMigrationPaths {
  legacyDir: string;
  legacyDataDir: string;
  ommsDir: string;
  ommsDataDir: string;
  backupsDir: string;
  markerPath: string;
  lockPath: string;
}

export interface LegacyMigrationMarker {
  version: 1;
  status: "migrated" | "failed";
  source: string;
  destination: string;
  backupPath?: string;
  fileCount?: number;
  startedAt: string;
  completedAt?: string;
  /** Which stage failed, when status is "failed". */
  stage?: "backup" | "copy";
  error?: string;
}

export type LegacyMigrationResult =
  | { kind: "migrated"; marker: LegacyMigrationMarker }
  | { kind: "already-migrated"; marker: LegacyMigrationMarker }
  | { kind: "failed-marker"; marker: LegacyMigrationMarker }
  | { kind: "failed"; marker: LegacyMigrationMarker }
  | { kind: "fresh" }
  | { kind: "destination-exists" }
  | { kind: "in-progress" };

interface BackupManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

export function legacyMigrationPaths(home: string = homedir()): LegacyMigrationPaths {
  const legacyDir = join(home, LEGACY_DIR_NAME);
  const ommsDir = join(home, OMMS_DIR_NAME);
  return {
    legacyDir,
    legacyDataDir: join(legacyDir, DATA_SUBDIR),
    ommsDir,
    ommsDataDir: join(ommsDir, DATA_SUBDIR),
    backupsDir: join(ommsDir, BACKUPS_SUBDIR),
    markerPath: join(ommsDir, MARKER_FILE),
    lockPath: join(ommsDir, LOCK_FILE),
  };
}

export function readLegacyMigrationMarker(home: string = homedir()): LegacyMigrationMarker | null {
  const { markerPath } = legacyMigrationPaths(home);
  if (!existsSync(markerPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(markerPath, "utf-8")) as LegacyMigrationMarker;
    if (
      raw &&
      (raw.status === "migrated" || raw.status === "failed") &&
      typeof raw.source === "string" &&
      typeof raw.destination === "string"
    ) {
      return { ...raw, version: 1 };
    }
  } catch {
    // A corrupt marker is treated as absent; rerun logic then retries.
  }
  return null;
}

/**
 * Default storage resolution shared with config.ts. While a legacy store
 * exists and the migration has not succeeded, storage keeps resolving to the
 * legacy layout (covering both "migration pending" and "migration failed").
 * After a successful migration, or on a fresh install, the omms path wins.
 */
export function resolveDefaultStoragePath(home: string = homedir()): string {
  const { legacyDataDir, ommsDataDir } = legacyMigrationPaths(home);
  if (existsSync(legacyDataDir)) {
    const marker = readLegacyMigrationMarker(home);
    if (marker?.status === "migrated") return ommsDataDir;
    return legacyDataDir;
  }
  return ommsDataDir;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface TreeWalk {
  files: string[];
  dirs: string[];
}

function walkTree(root: string): TreeWalk {
  const files: string[] = [];
  const dirs: string[] = [];
  const visit = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        dirs.push(childRel);
        visit(join(dir, entry.name), childRel);
      } else {
        // Symlinks and other non-directory entries are copied as files.
        files.push(childRel);
      }
    }
  };
  visit(root, "");
  return { files, dirs };
}

function timestampSlug(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Claim the migration with a PID-liveness lock file so two hosts starting at
 * the same time cannot copy into the destination concurrently. A stale lock
 * (dead holder) is taken over; a live one defers this run.
 */
function acquireMigrationLock(paths: LegacyMigrationPaths): boolean {
  const state = JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(paths.lockPath, state, { flag: "wx" });
      return true;
    } catch {
      try {
        const holder = JSON.parse(readFileSync(paths.lockPath, "utf-8")) as { pid?: number };
        if (typeof holder.pid === "number" && Number.isInteger(holder.pid)) {
          if (isProcessAlive(holder.pid)) {
            return false;
          }
        }
        unlinkSync(paths.lockPath);
      } catch {
        return false;
      }
    }
  }
  return false;
}

function releaseMigrationLock(paths: LegacyMigrationPaths): void {
  try {
    unlinkSync(paths.lockPath);
  } catch {
    // Best effort: a stale lock file is cleaned up by the next acquirer.
  }
}

function writeMarker(paths: LegacyMigrationPaths, marker: LegacyMigrationMarker): void {
  writeFileSync(paths.markerPath, JSON.stringify(marker, null, 2), "utf-8");
}

/**
 * Copy every file under `sourceRoot` into `destRoot` (mirroring structure),
 * producing a checksum manifest, then verify every copied file by re-reading
 * it and comparing size and sha256. Throws on any failure.
 */
function copyTreeWithVerification(sourceRoot: string, destRoot: string): BackupManifestEntry[] {
  const { files, dirs } = walkTree(sourceRoot);
  mkdirSync(destRoot, { recursive: true });
  for (const rel of dirs) {
    mkdirSync(join(destRoot, rel), { recursive: true });
  }
  const manifest: BackupManifestEntry[] = [];
  for (const rel of files) {
    const sourcePath = join(sourceRoot, rel);
    const destPath = join(destRoot, rel);
    const size = statSync(sourcePath).size;
    copyFileSync(sourcePath, destPath);
    const sha256 = sha256File(destPath);
    manifest.push({ path: rel, size, sha256 });
  }
  verifyManifest(destRoot, manifest);
  return manifest;
}

function verifyManifest(root: string, manifest: BackupManifestEntry[]): void {
  for (const entry of manifest) {
    const path = join(root, entry.path);
    const size = statSync(path).size;
    if (size !== entry.size) {
      throw new Error(`size mismatch for ${entry.path}: ${size} != ${entry.size}`);
    }
    const sha256 = sha256File(path);
    if (sha256 !== entry.sha256) {
      throw new Error(`checksum mismatch for ${entry.path}`);
    }
  }
}

/**
 * Copy the store from the legacy data directory to the omms data directory,
 * verifying every copied file against its source checksum. Returns the
 * number of files copied. Throws on any failure.
 */
function copyStoreWithVerification(sourceRoot: string, destRoot: string): number {
  const { files, dirs } = walkTree(sourceRoot);
  mkdirSync(destRoot, { recursive: true });
  for (const rel of dirs) {
    mkdirSync(join(destRoot, rel), { recursive: true });
  }
  for (const rel of files) {
    const sourcePath = join(sourceRoot, rel);
    const destPath = join(destRoot, rel);
    const sourceHash = sha256File(sourcePath);
    copyFileSync(sourcePath, destPath);
    const destHash = sha256File(destPath);
    if (destHash !== sourceHash) {
      throw new Error(`checksum mismatch for ${rel}`);
    }
  }
  return files.length;
}

/**
 * Run the one-time legacy store migration for the given home directory.
 * Pure module: no environment-variable switches, no CONFIG dependency.
 * Hosts integrate it through initConfigWithLegacyMigration in config.ts.
 */
export function runLegacyStoreMigration(home: string = homedir()): LegacyMigrationResult {
  const paths = legacyMigrationPaths(home);
  const existingMarker = readLegacyMigrationMarker(home);
  if (existingMarker) {
    return existingMarker.status === "migrated"
      ? { kind: "already-migrated", marker: existingMarker }
      : { kind: "failed-marker", marker: existingMarker };
  }
  if (!existsSync(paths.legacyDataDir)) {
    return { kind: "fresh" };
  }
  if (existsSync(paths.ommsDataDir)) {
    // A destination that exists without a marker is not overwritten; storage
    // resolution keeps the legacy layout (marker absent). Recovery is manual:
    // docs/omms-migration.md.
    return { kind: "destination-exists" };
  }

  const startedAt = new Date().toISOString();
  let backupPath: string | undefined;

  mkdirSync(paths.ommsDir, { recursive: true });
  if (!acquireMigrationLock(paths)) {
    return { kind: "in-progress" };
  }

  try {
    // Stage 1: verified backup of the ENTIRE legacy directory.
    backupPath = join(paths.backupsDir, `opencode-mem-${timestampSlug()}`);
    try {
      const manifest = copyTreeWithVerification(paths.legacyDir, backupPath);
      writeFileSync(
        join(backupPath, MANIFEST_FILE),
        JSON.stringify(
          {
            createdAt: startedAt,
            source: paths.legacyDir,
            fileCount: manifest.length,
            files: manifest,
          },
          null,
          2
        ),
        "utf-8"
      );
    } catch (error) {
      // Backup failure aborts before anything is migrated.
      try {
        if (existsSync(backupPath)) rmSync(backupPath, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup of the partial backup.
      }
      const marker: LegacyMigrationMarker = {
        version: 1,
        status: "failed",
        stage: "backup",
        source: paths.legacyDataDir,
        destination: paths.ommsDataDir,
        startedAt,
        completedAt: new Date().toISOString(),
        error: String(error),
      };
      writeMarker(paths, marker);
      log("Legacy migration aborted during backup", { error: String(error) });
      return { kind: "failed", marker };
    }

    // Stage 2: copy the store, verifying every file against its source.
    try {
      const fileCount = copyStoreWithVerification(paths.legacyDataDir, paths.ommsDataDir);
      const marker: LegacyMigrationMarker = {
        version: 1,
        status: "migrated",
        source: paths.legacyDataDir,
        destination: paths.ommsDataDir,
        backupPath,
        fileCount,
        startedAt,
        completedAt: new Date().toISOString(),
      };
      writeMarker(paths, marker);
      log("Legacy opencode-mem store migrated to omms layout", {
        source: marker.source,
        destination: marker.destination,
        backupPath,
        fileCount,
      });
      return { kind: "migrated", marker };
    } catch (error) {
      // Verification failure aborts and marks the migration failed. The
      // legacy directory was only ever read; the partial destination is
      // removed so an explicit retry can proceed cleanly.
      try {
        if (existsSync(paths.ommsDataDir)) {
          rmSync(paths.ommsDataDir, { recursive: true, force: true });
        }
      } catch {
        // Best-effort cleanup; recovery is documented.
      }
      const marker: LegacyMigrationMarker = {
        version: 1,
        status: "failed",
        stage: "copy",
        source: paths.legacyDataDir,
        destination: paths.ommsDataDir,
        backupPath,
        startedAt,
        completedAt: new Date().toISOString(),
        error: String(error),
      };
      writeMarker(paths, marker);
      log("Legacy migration aborted during store copy", { error: String(error) });
      return { kind: "failed", marker };
    }
  } finally {
    releaseMigrationLock(paths);
  }
}
