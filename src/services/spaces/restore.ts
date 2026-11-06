import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  SPACE_BACKUP_PREFIX,
  readBackupManifest,
  verifyBackup,
  type SpaceBackupManifest,
} from "./backup.js";
import { MAX_SPACE_NAME_LENGTH, SpaceError, type SpaceEntry } from "./registry.js";
import { createStoredSpace, removeStoredSpace, type SpaceFiles } from "./registry-store.js";

export interface BackupSummary {
  /** The full path of the backup folder. */
  path: string;
  spaceId: string;
  spaceName: string;
  createdAt: string;
  fileCount: number;
  /** The total size of the backed-up files. */
  sizeBytes: number;
}

/** The space backups in the backups folder, newest first. A folder that is not a valid backup is left out. */
export function listBackups(backupsRoot: string): BackupSummary[] {
  if (!existsSync(backupsRoot)) return [];
  const summaries: BackupSummary[] = [];
  for (const entry of readdirSync(backupsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(SPACE_BACKUP_PREFIX)) continue;
    const path = join(backupsRoot, entry.name);
    let manifest: SpaceBackupManifest;
    try {
      manifest = readBackupManifest(path);
    } catch {
      continue;
    }
    summaries.push({
      path,
      spaceId: manifest.spaceId,
      spaceName: manifest.spaceName,
      createdAt: manifest.createdAt,
      fileCount: manifest.files.length,
      sizeBytes: manifest.files.reduce((total, file) => total + file.size, 0),
    });
  }
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** `<name> (restored <date>)`, with the name cut so the whole display name fits the limit. */
function restoredName(name: string, date: Date, attempt: number): string {
  const suffix = ` (restored ${date.toISOString().slice(0, 10)})${attempt > 1 ? ` ${attempt}` : ""}`;
  return `${name.slice(0, MAX_SPACE_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

/**
 * Restores a backup into a new space (design D7). It checks every file against the manifest
 * first and creates nothing when one is damaged. It never replaces an existing space and never
 * changes the active space.
 */
export async function restoreBackup(
  files: SpaceFiles,
  backupPath: string,
  now: Date = new Date()
): Promise<SpaceEntry> {
  const manifest = readBackupManifest(backupPath);
  try {
    verifyBackup(backupPath, manifest);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Restore refused, the backup is damaged: ${reason}`, { cause: error });
  }
  const space = await createWithFreeName(files, manifest.spaceName, now);
  const folder = join(files.spacesRoot, space.id);
  try {
    for (const rel of manifest.files.map((file) => file.path)) {
      mkdirSync(dirname(join(folder, rel)), { recursive: true });
      copyFileSync(join(backupPath, rel), join(folder, rel));
    }
    verifyBackup(folder, manifest);
  } catch (error) {
    await removeStoredSpace(files, space.id);
    rmSync(folder, { recursive: true, force: true });
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Restore failed: ${reason}`, { cause: error });
  }
  return space;
}

async function createWithFreeName(files: SpaceFiles, name: string, now: Date): Promise<SpaceEntry> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await createStoredSpace(files, restoredName(name, now, attempt));
    } catch (error) {
      const taken = error instanceof SpaceError && ["name-taken", "id-taken"].includes(error.code);
      if (!taken || attempt >= 50) throw error;
    }
  }
}
