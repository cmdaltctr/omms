import {
  constants,
  createReadStream,
  createWriteStream,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { log } from "../services/logger.js";
import { withSqliteFileLockRetry } from "../services/turso/sqlite-handle-release.js";

/**
 * Private copies of a live OpenCode database. A normal SQLite open writes to
 * OpenCode's `-shm`, and `immutable=1` ignores the WAL, so a copy of the
 * database and its WAL is the only way to read uncheckpointed turns while
 * leaving every source file untouched.
 *
 * Copies run asynchronously so the OpenCode process that hosts the web UI and
 * live capture keeps responding, and they can be cancelled. One copy per
 * source is shared by the web listing, preview, and import.
 */

export const SNAPSHOT_PREFIX = "omms-opencode-";
export const SNAPSHOT_IDLE_MS = 30 * 60 * 1000;
/** Sources above this size, or on another device, get one copy attempt instead of five. */
export const SINGLE_ATTEMPT_BYTES = 1024 ** 3;
const MIN_MARGIN_BYTES = 256 * 1024 ** 2;
const OWNER_FILE = "owner.json";

export type SnapshotErrorCode = "no-space" | "changing" | "busy" | "expired";

export class OpencodeSnapshotError extends Error {
  constructor(
    readonly code: SnapshotErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OpencodeSnapshotError";
  }
}

export interface SnapshotLease {
  /** Path of the private database copy. */
  path: string;
  release: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.ceil(bytes / 1024 ** 2)} MB`;
}

function fileStamp(path: string): string {
  const info = statSync(path, { bigint: true });
  return `${info.size}:${info.mtimeNs}`;
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Bytes a snapshot of `dbPath` needs in the temporary folder, margin included. */
export function snapshotSpaceNeeded(dbPath: string): number {
  const total = fileSize(dbPath) + fileSize(`${dbPath}-wal`);
  return total + Math.max(MIN_MARGIN_BYTES, Math.ceil(total * 0.1));
}

export function checkSnapshotSpace(
  dbPath: string,
  folder = tmpdir(),
  available = (() => {
    const info = statfsSync(folder);
    return Number(info.bavail) * Number(info.bsize);
  })()
): void {
  const needed = snapshotSpaceNeeded(dbPath);
  if (available < needed) {
    throw new OpencodeSnapshotError(
      "no-space",
      `Not enough temporary space to copy the OpenCode database: needs ${formatBytes(needed)}, ` +
        `${formatBytes(available)} free in ${folder}. Free space there or choose a checkpointed backup.`
    );
  }
}

/**
 * Remove a snapshot folder without ever failing the import. Windows can hold
 * SQLite files briefly after close, so retry lock errors; if the lock
 * outlasts the retries, log the leftover path instead of throwing.
 */
export async function removeSnapshotDir(dir: string): Promise<void> {
  try {
    await withSqliteFileLockRetry(() => rmSync(dir, { recursive: true, force: true }));
  } catch (error) {
    log("OpenCode import: could not remove the temporary database copy", {
      dir,
      code: (error as NodeJS.ErrnoException).code ?? "error",
    });
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Delete snapshot folders left by processes that no longer run, such as an
 * OpenCode window that quit mid-import. A folder whose owner is alive, or
 * whose owner file is unreadable because it is still being created, is kept.
 */
export async function sweepOrphanSnapshots(folder = tmpdir()): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(folder).filter((name) => name.startsWith(SNAPSHOT_PREFIX));
  } catch {
    return 0;
  }
  for (const name of entries) {
    const dir = join(folder, name);
    let owner: { pid?: unknown };
    try {
      owner = JSON.parse(readFileSync(join(dir, OWNER_FILE), "utf8")) as { pid?: unknown };
    } catch {
      continue;
    }
    if (typeof owner.pid !== "number" || processAlive(owner.pid)) continue;
    await removeSnapshotDir(dir);
    removed++;
  }
  return removed;
}

async function copyOne(
  source: string,
  target: string,
  signal?: AbortSignal,
  clone = true
): Promise<void> {
  signal?.throwIfAborted();
  if (clone) {
    try {
      // A copy-on-write clone (APFS, Btrfs) is instant and runs off the event loop.
      await copyFile(source, target, constants.COPYFILE_FICLONE_FORCE);
      return;
    } catch {
      // No clone support here, or another device: stream the bytes instead.
    }
  }
  await pipeline(createReadStream(source), createWriteStream(target), { signal });
}

/**
 * Copy `dbPath` and its WAL into a private folder. A copy that raced a write
 * or checkpoint is discarded and retried, but only once for large or
 * cross-device sources, where each attempt can take minutes.
 */
export async function createOpencodeSnapshot(
  dbPath: string,
  options: { signal?: AbortSignal; folder?: string; clone?: boolean } = {}
): Promise<{ dir: string; path: string }> {
  const folder = options.folder ?? tmpdir();
  await sweepOrphanSnapshots(folder);
  checkSnapshotSpace(dbPath, folder);
  const wal = `${dbPath}-wal`;
  const total = fileSize(dbPath) + fileSize(wal);
  let sameDevice = false;
  try {
    sameDevice = statSync(folder).dev === statSync(dbPath).dev;
  } catch {
    // Unknown device: treat it as another one.
  }
  const attempts = sameDevice && total <= SINGLE_ATTEMPT_BYTES ? 5 : 1;

  const dir = mkdtempSync(join(folder, SNAPSHOT_PREFIX));
  writeFileSync(join(dir, OWNER_FILE), JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
  const copy = join(dir, "opencode.db");
  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const before = [fileStamp(dbPath), fileStamp(wal)];
      await copyOne(dbPath, copy, options.signal, options.clone);
      await copyOne(wal, `${copy}-wal`, options.signal, options.clone);
      const after = [fileStamp(dbPath), fileStamp(wal)];
      if (before[0] === after[0] && before[1] === after[1]) return { dir, path: copy };
    }
  } catch (error) {
    await removeSnapshotDir(dir);
    throw error;
  }
  await removeSnapshotDir(dir);
  throw new OpencodeSnapshotError(
    "changing",
    attempts === 1
      ? "The OpenCode database changed while it was copied. Quit OpenCode, or choose a checkpointed backup, and retry."
      : "OpenCode database kept changing while it was copied; retry the import"
  );
}

interface SharedSnapshot {
  dir: string;
  path: string;
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
  retired: boolean;
}

/**
 * Snapshots shared by source key (real path, device, inode). A fresh request
 * replaces the current copy for later callers; a job still reading the old
 * copy keeps it until it releases it.
 */
export class OpencodeSnapshotRegistry {
  private readonly current = new Map<string, SharedSnapshot>();
  private readonly pending = new Map<string, Promise<SharedSnapshot>>();
  private readonly all = new Set<SharedSnapshot>();

  constructor(
    private readonly idleMs = SNAPSHOT_IDLE_MS,
    private readonly create = createOpencodeSnapshot
  ) {}

  /**
   * `fresh` makes a new copy (a listing refresh); `reuse` only returns an
   * existing copy and fails as expired when there is none (a job).
   */
  async acquire(
    key: string,
    dbPath: string,
    mode: "fresh" | "reuse" | "any",
    signal?: AbortSignal
  ): Promise<SnapshotLease> {
    let shared = mode === "fresh" ? undefined : this.current.get(key);
    if (!shared) {
      if (mode === "reuse") {
        throw new OpencodeSnapshotError(
          "expired",
          "The session list is out of date. Refresh the list and try again."
        );
      }
      let creating = mode === "fresh" ? undefined : this.pending.get(key);
      if (!creating) {
        creating = this.create(dbPath, { signal }).then((copy) => {
          const next: SharedSnapshot = { ...copy, refs: 0, retired: false };
          const previous = this.current.get(key);
          if (previous) this.retire(previous);
          this.current.set(key, next);
          this.all.add(next);
          return next;
        });
        this.pending.set(key, creating);
        creating.then(
          () => this.pending.delete(key),
          () => this.pending.delete(key)
        );
      }
      shared = await creating;
    }
    const lease = shared;
    lease.refs++;
    if (lease.timer) clearTimeout(lease.timer);
    lease.timer = undefined;
    let released = false;
    return {
      path: lease.path,
      release: async () => {
        if (released) return;
        released = true;
        lease.refs--;
        if (lease.refs > 0) return;
        if (lease.retired) return this.remove(lease);
        lease.timer = setTimeout(() => {
          if (this.current.get(key) === lease) this.current.delete(key);
          void this.remove(lease);
        }, this.idleMs);
        lease.timer.unref?.();
      },
    };
  }

  private retire(shared: SharedSnapshot): void {
    shared.retired = true;
    if (shared.refs === 0) void this.remove(shared);
  }

  private async remove(shared: SharedSnapshot): Promise<void> {
    if (shared.timer) clearTimeout(shared.timer);
    if (!this.all.delete(shared)) return;
    await removeSnapshotDir(shared.dir);
  }

  /**
   * Drop the current copy for a source after a real import: a later listing
   * copies afresh. A job still reading it keeps it until it releases it.
   */
  discard(key: string): void {
    const shared = this.current.get(key);
    if (!shared) return;
    this.current.delete(key);
    this.retire(shared);
  }

  /** Remove every copy, for server shutdown. */
  async closeAll(): Promise<void> {
    this.current.clear();
    await Promise.all([...this.all].map((shared) => this.remove(shared)));
  }
}

export const opencodeSnapshots = new OpencodeSnapshotRegistry();

/** An unshared snapshot for one CLI or slash-command run. */
export async function acquirePrivateSnapshot(
  dbPath: string,
  signal?: AbortSignal
): Promise<SnapshotLease> {
  const copy = await createOpencodeSnapshot(dbPath, { signal });
  return { path: copy.path, release: () => removeSnapshotDir(copy.dir) };
}
