import { createClient } from "@libsql/client";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  sha256File,
  timestampSlug,
  verifyManifest,
  walkTree,
  type BackupManifestEntry,
} from "../legacy-migration.js";

/**
 * Space backups (design D6). A backup is a folder `space-<id>-<timestamp>` under the backups
 * root. It holds a copy of every store file of the space and a `manifest.json` with the SHA-256
 * of each copy. SQLite files are copied with `VACUUM INTO`, which gives one consistent snapshot
 * while other connections write. Other files are copied byte for byte.
 */

export const MANIFEST_FILE = "manifest.json";
export const SPACE_BACKUP_KIND = "space-backup";
export const SPACE_BACKUP_PREFIX = "space-";

/** Folders that hold no memory data: the model cache is shared, and lock files are transient. */
const SKIPPED_FOLDERS = [".cache", ".write-locks"];
/** Files SQLite keeps next to a database while it is open. `VACUUM INTO` makes them unnecessary. */
const SKIPPED_SUFFIXES = ["-journal", "-wal", "-shm"];

export interface BackupManifest {
  createdAt: string;
  kind: string;
  fileCount: number;
  files: BackupManifestEntry[];
}

export interface SpaceBackupManifest extends BackupManifest {
  kind: typeof SPACE_BACKUP_KIND;
  spaceId: string;
  spaceName: string;
  ommsVersion: string;
}

export interface BackupDeps {
  /** Writes a consistent copy of the SQLite file `source` to `destination`. */
  vacuumInto(source: string, destination: string): Promise<void>;
  copyFile(source: string, destination: string): void;
}

async function vacuumInto(source: string, destination: string): Promise<void> {
  const client = createClient({ url: `file:${source}` });
  try {
    await client.execute("PRAGMA busy_timeout = 5000");
    await client.execute({ sql: "VACUUM INTO ?", args: [destination] });
  } finally {
    client.close();
  }
}

const defaultDeps: BackupDeps = { vacuumInto, copyFile: copyFileSync };

/** Writes `manifest.json` in a backup folder. */
export function writeBackupManifest(backupRoot: string, manifest: object): void {
  writeFileSync(join(backupRoot, MANIFEST_FILE), JSON.stringify(manifest, null, 2), "utf-8");
}

/** Reads `manifest.json` from a backup folder. Throws a plain message when it is missing or invalid. */
export function readBackupManifest(backupRoot: string): SpaceBackupManifest {
  const path = join(backupRoot, MANIFEST_FILE);
  if (!existsSync(path)) throw new Error(`The backup has no ${MANIFEST_FILE}.`);
  let manifest: Partial<SpaceBackupManifest>;
  try {
    manifest = JSON.parse(readFileSync(path, "utf-8")) as Partial<SpaceBackupManifest>;
  } catch {
    throw new Error(`The backup ${MANIFEST_FILE} cannot be read.`);
  }
  if (
    manifest.kind !== SPACE_BACKUP_KIND ||
    typeof manifest.spaceId !== "string" ||
    typeof manifest.spaceName !== "string" ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("The folder is not a space backup.");
  }
  return manifest as SpaceBackupManifest;
}

/** Checks every file of a backup against its manifest. The error names the first damaged file. */
export function verifyBackup(backupRoot: string, manifest: BackupManifest): void {
  verifyManifest(backupRoot, manifest.files);
}

function isStoreFile(relPath: string): boolean {
  const parts = relPath.split("/");
  if (parts.some((part) => SKIPPED_FOLDERS.includes(part))) return false;
  // The root space.json label is live-instance state; a restored space gets a fresh one.
  if (parts.length === 1 && parts[0] === "space.json") return false;
  return !SKIPPED_SUFFIXES.some((suffix) => relPath.endsWith(suffix));
}

function uniqueBackupFolder(backupsRoot: string, id: string, now: Date): string {
  const base = join(backupsRoot, `${SPACE_BACKUP_PREFIX}${id}-${timestampSlug(now)}`);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!existsSync(candidate)) return candidate;
  }
}

/** Copies one file and checks the copy against its source, once more if the source moved on. */
function copyChecked(deps: BackupDeps, source: string, destination: string): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    deps.copyFile(source, destination);
    if (sha256File(destination) === sha256File(source)) return;
  }
  throw new Error("the copy does not match the original");
}

export interface BackupInput {
  space: { id: string; name: string };
  /** The folder of the space to copy. */
  spaceFolder: string;
  backupsRoot: string;
  ommsVersion: string;
  now?: Date;
}

/**
 * Backs up one space and verifies the copy. On any failure the incomplete backup folder is
 * removed and the error names the file that failed. The space folder is never changed.
 */
export async function backupSpace(
  input: BackupInput,
  overrides: Partial<BackupDeps> = {}
): Promise<{ backupPath: string; manifest: SpaceBackupManifest }> {
  const deps = { ...defaultDeps, ...overrides };
  const now = input.now ?? new Date();
  mkdirSync(input.backupsRoot, { recursive: true });
  const backupPath = uniqueBackupFolder(input.backupsRoot, input.space.id, now);
  mkdirSync(backupPath);
  let current = "";
  try {
    const files: BackupManifestEntry[] = [];
    for (const rel of walkTree(input.spaceFolder).files.filter(isStoreFile)) {
      current = rel;
      const source = join(input.spaceFolder, rel);
      const destination = join(backupPath, rel);
      mkdirSync(dirname(destination), { recursive: true });
      if (rel.endsWith(".db")) await deps.vacuumInto(source, destination);
      else copyChecked(deps, source, destination);
      files.push({ path: rel, size: statSync(destination).size, sha256: sha256File(destination) });
    }
    current = "";
    const manifest: SpaceBackupManifest = {
      createdAt: now.toISOString(),
      kind: SPACE_BACKUP_KIND,
      spaceId: input.space.id,
      spaceName: input.space.name,
      ommsVersion: input.ommsVersion,
      fileCount: files.length,
      files,
    };
    writeBackupManifest(backupPath, manifest);
    verifyBackup(backupPath, manifest);
    return { backupPath, manifest };
  } catch (error) {
    rmSync(backupPath, { recursive: true, force: true });
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Backup failed${current ? ` at ${current}` : ""}: ${reason}`, {
      cause: error,
    });
  }
}
