import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { CONFIG, getExplicitContainerTagPrefix } from "../config.js";
import { log } from "./logger.js";
import {
  copyFilesWithVerification,
  timestampSlug,
  walkTree,
  type BackupManifestEntry,
} from "./legacy-migration.js";
import { withCrossProcessWriteLock } from "./turso/cross-process-write-lock.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import { tursoShardManager } from "./turso/shard-manager.js";
import type { TursoDb } from "./turso/turso-db.js";
import type { InArgs, ResultSet, Transaction } from "@libsql/client";

/**
 * One-time migration of the stored container tag prefix from `opencode_` to
 * `omms_` (OpenSpec change migrate-container-tag-prefix-to-omms).
 *
 * Safety rules (design.md, in priority order):
 * 1. A timestamped, checksum-verified backup of the ENTIRE store directory is
 *    created before any shard is rewritten. Backup failure aborts loudly with
 *    nothing rewritten.
 * 2. Each shard rewrite is a single SQL UPDATE inside the shard's write
 *    transaction, under the existing per-scope cross-process write lock, with
 *    before/after invariants (row count, id set, rewritten count, zero
 *    remaining opencode_ rows). Any mismatch rolls the shard back and aborts
 *    the run; already-committed shards stay migrated and the next run resumes.
 * 3. Store-level completion is recorded in a `tag_prefix_migration` table in
 *    metadata.db; per-shard completion in each shard's shard_metadata table,
 *    committed with the rewrite. The scan, not the marker, is the source of
 *    truth: a marker-less store with zero opencode_ rows completes as a
 *    no-op rewrite.
 * 4. The whole migration holds a store-level PID-liveness gate lock so two
 *    hosts starting together cannot both rewrite; normal writers are
 *    serialised per scope by the existing cross-process write lock.
 * 5. The backup and the pre-migration state are never deleted or modified.
 *    Rollback is restore-from-backup (docs/omms-migration.md).
 */

const FROM_PREFIX = "opencode";
const TO_PREFIX = "omms";
const FROM_PREFIX_WITH_SEP = "opencode_";
const TO_PREFIX_WITH_SEP = "omms_";
const METADATA_DB_NAME = "metadata.db";
const MANIFEST_FILE = "manifest.json";
const COMPLETION_TABLE = "tag_prefix_migration";
const SHARD_MARKER_TABLE = "shard_metadata";
const BACKUPS_DIR_NAME = "backups";
const BACKUP_SLUG_PREFIX = "tag-prefix-";
const GATE_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const GATE_LOCK_POLL_MS = 50;

/** Matches the shard file naming used by tursoShardManager.getShardPath. */
const SHARD_FILENAME_RE = /^(user|project)_([a-f0-9]{16})_shard_(\d+)\.db$/;

export const TAG_PREFIX_MIGRATION_LOCK_FILE = ".tag-prefix-migration.lock";
export const SHARD_MARKER_KEY = "tag_prefix_migration";

export interface TagPrefixShardOutcome {
  dbPath: string;
  scope: "user" | "project";
  scopeHash: string;
  shardIndex: number;
  rewritten: number;
  skipped: boolean;
}

export type TagPrefixMigrationResult =
  | {
      status: "migrated";
      backupPath: string;
      shardsScanned: number;
      shardsRewritten: number;
      rowsRewritten: number;
      shards: TagPrefixShardOutcome[];
      startedAt: string;
      completedAt: string;
    }
  | { status: "not-needed"; shardsScanned: number }
  | { status: "already-migrated" };

export interface TagPrefixMigrationCompletion {
  completedAt: string;
  backupPath: string | null;
  shardsRewritten: number;
  rowsRewritten: number;
}

interface ShardTarget {
  dbPath: string;
  scope: "user" | "project";
  scopeHash: string;
  shardIndex: number;
}

interface GateLockState {
  pid: number;
  timestamp: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function gateLockPath(storePath: string): string {
  return join(storePath, TAG_PREFIX_MIGRATION_LOCK_FILE);
}

function readLiveGateLock(path: string): GateLockState | null {
  if (!existsSync(path)) return null;
  try {
    const state = JSON.parse(readFileSync(path, "utf-8")) as GateLockState;
    if (Number.isInteger(state.pid) && state.pid > 0 && isProcessAlive(state.pid)) {
      return state;
    }
  } catch {
    // Corrupt lock files are stale; remove below.
  }
  try {
    unlinkSync(path);
  } catch {
    // Already removed by a racing acquirer.
  }
  return null;
}

/**
 * Acquire the store-level migration gate lock (PID-liveness, same pattern as
 * the legacy directory migration). Blocks while a live holder runs; fails
 * loudly after GATE_LOCK_TIMEOUT_MS so a wedged holder can never deadlock
 * every host permanently. A stale lock (crashed holder) is taken over.
 */
async function acquireGateLock(storePath: string): Promise<() => void> {
  const path = gateLockPath(storePath);
  const state: GateLockState = { pid: process.pid, timestamp: new Date().toISOString() };
  const deadline = Date.now() + GATE_LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      writeFileSync(path, JSON.stringify(state), { flag: "wx" });
      break;
    } catch {
      const holder = readLiveGateLock(path);
      if (!holder) continue;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for the container tag prefix migration gate lock at ${path}: ` +
            `held by pid ${holder.pid} since ${holder.timestamp}. Close the other omms/opencode ` +
            `process, or remove the lock file if that process has crashed, then start again.`
        );
      }
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, GATE_LOCK_POLL_MS + Math.random() * 10)
      );
    }
  }

  return () => {
    try {
      unlinkSync(path);
    } catch {
      // Best effort: a stale file is cleaned up by the next acquirer.
    }
  };
}

async function ensureCompletionTable(db: TursoDb): Promise<void> {
  await db.batch([
    {
      sql: `
        CREATE TABLE IF NOT EXISTS ${COMPLETION_TABLE} (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          status TEXT NOT NULL,
          from_prefix TEXT NOT NULL,
          to_prefix TEXT NOT NULL,
          backup_path TEXT,
          shards_rewritten INTEGER NOT NULL,
          rows_rewritten INTEGER NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT NOT NULL
        )
      `,
    },
  ]);
}

async function readCompletion(db: TursoDb): Promise<TagPrefixMigrationCompletion | null> {
  await ensureCompletionTable(db);
  const row = await db.get<{
    completed_at: string;
    backup_path: string | null;
    shards_rewritten: number;
    rows_rewritten: number;
  }>(`SELECT * FROM ${COMPLETION_TABLE} WHERE id = 1`);
  if (!row) return null;
  return {
    completedAt: String(row.completed_at),
    backupPath: row.backup_path === null ? null : String(row.backup_path),
    shardsRewritten: Number(row.shards_rewritten),
    rowsRewritten: Number(row.rows_rewritten),
  };
}

/**
 * Read the store-level completion marker from `<storePath>/metadata.db`.
 * Returns null when the store has not completed the tag prefix migration.
 * `storePath` must equal CONFIG.storagePath (the connection manager refuses
 * paths outside it).
 */
export async function readTagPrefixMigrationCompletion(
  storePath: string
): Promise<TagPrefixMigrationCompletion | null> {
  const db = await tursoConnectionManager.getConnection(join(storePath, METADATA_DB_NAME));
  return readCompletion(db);
}

async function writeCompletionMarker(
  db: TursoDb,
  entry: {
    backupPath: string | null;
    shardsRewritten: number;
    rowsRewritten: number;
    startedAt: string;
  }
): Promise<void> {
  await db.run(
    `
      INSERT OR REPLACE INTO ${COMPLETION_TABLE}
        (id, status, from_prefix, to_prefix, backup_path, shards_rewritten, rows_rewritten, started_at, completed_at)
      VALUES (1, 'completed', ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      FROM_PREFIX,
      TO_PREFIX,
      entry.backupPath,
      entry.shardsRewritten,
      entry.rowsRewritten,
      entry.startedAt,
      new Date().toISOString(),
    ]
  );
}

function listShardDirFiles(storePath: string, scopeDir: "users" | "projects"): string[] {
  const dir = join(storePath, scopeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".db") && !file.includes(".bak") && !file.includes(".tmp"))
    .map((file) => join(dir, file));
}

/**
 * Enumerate every shard file to migrate: the metadata.db registry first (the
 * authoritative set), then any on-disk shard file in users/ or projects/ not
 * present in the registry (orphans still need rewriting). Deduplicated by
 * resolved path, ordered deterministically.
 */
async function enumerateShardTargets(storePath: string): Promise<ShardTarget[]> {
  const byPath = new Map<string, ShardTarget>();

  for (const scope of ["user", "project"] as const) {
    for (const shard of await tursoShardManager.getAllShards(scope, "")) {
      byPath.set(shard.dbPath, {
        dbPath: shard.dbPath,
        scope,
        scopeHash: shard.scopeHash,
        shardIndex: shard.shardIndex,
      });
    }
  }

  for (const scopeDir of ["users", "projects"] as const) {
    for (const dbPath of listShardDirFiles(storePath, scopeDir)) {
      const match = SHARD_FILENAME_RE.exec(basename(dbPath));
      if (!match) continue;
      const resolved = dbPath;
      if (byPath.has(resolved)) continue;
      byPath.set(resolved, {
        dbPath,
        scope: match[1] as "user" | "project",
        scopeHash: match[2]!,
        shardIndex: Number(match[3]),
      });
    }
  }

  return [...byPath.values()].sort((a, b) => a.dbPath.localeCompare(b.dbPath));
}

async function countPrefixedInConnection(
  db: TursoDb,
  prefixWithSep: string
): Promise<number | null> {
  try {
    const row = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM memories WHERE container_tag LIKE ? ESCAPE '\\'`,
      [`${prefixWithSep.slice(0, -1)}\\_%`]
    );
    return Number(row?.count ?? 0);
  } catch {
    // Files without a memories table (or unreadable ones) contribute nothing.
    return null;
  }
}

/**
 * Read-only helper: total rows still carrying the `opencode_` prefix across
 * every shard file in the store. Also fails loudly when a non-shard .db file
 * in users/ or projects/ still carries opencode_ rows: such a file cannot be
 * locked per scope, and silently skipping it would leave a mixed-prefix
 * namespace (design D2 forbids that).
 */
export async function countOpencodePrefixedRows(storePath: string): Promise<number> {
  let total = 0;
  for (const scopeDir of ["users", "projects"] as const) {
    for (const dbPath of listShardDirFiles(storePath, scopeDir)) {
      const db = await tursoConnectionManager.getConnection(dbPath);
      const count = await countPrefixedInConnection(db, FROM_PREFIX_WITH_SEP);
      if (count === null) continue;
      const matchesNaming = SHARD_FILENAME_RE.test(basename(dbPath));
      if (!matchesNaming && count > 0) {
        throw new Error(
          `Shard file ${dbPath} does not match the shard filename pattern ` +
            `(scope_hash_shard_N.db) and still carries ${count} opencode_ row(s). ` +
            `Rename or inspect the file manually, then rerun the migration.`
        );
      }
      total += count;
    }
  }
  return total;
}

async function countLike(tx: Transaction, prefixWithSep: string): Promise<number> {
  const result: ResultSet = await tx.execute({
    sql: `SELECT COUNT(*) as count FROM memories WHERE container_tag LIKE ? ESCAPE '\\'`,
    args: [`${prefixWithSep.slice(0, -1)}\\_%`],
  });
  return Number((result.rows[0] as { count: number } | undefined)?.count ?? 0);
}

async function selectIdSet(tx: Transaction): Promise<Set<string>> {
  const result: ResultSet = await tx.execute({ sql: `SELECT id FROM memories`, args: [] });
  return new Set(result.rows.map((row) => String((row as Record<string, unknown>).id)));
}

function shardLabel(target: ShardTarget): string {
  return `${basename(target.dbPath)} (${target.scope}/${target.scopeHash})`;
}

/**
 * Rewrite one shard's opencode_ rows to omms_ inside the shard's write
 * transaction, under the existing per-scope cross-process write lock, with
 * per-shard before/after verification (design D3). Any invariant failure
 * throws, which rolls the transaction back; the abort names the shard.
 */
async function rewriteShard(target: ShardTarget): Promise<{ rewritten: number; skipped: boolean }> {
  return tursoShardManager.withScopeWriteLock(target.scope, target.scopeHash, async () => {
    const db = await tursoConnectionManager.getConnection(target.dbPath);
    try {
      return await db.transaction("write", async (tx) => {
        const beforeOld = await countLike(tx, FROM_PREFIX_WITH_SEP);
        if (beforeOld === 0) {
          return { rewritten: 0, skipped: true };
        }

        const beforeNew = await countLike(tx, TO_PREFIX_WITH_SEP);
        const beforeAllResult: ResultSet = await tx.execute({
          sql: `SELECT COUNT(*) as count FROM memories`,
          args: [] as InArgs,
        });
        const beforeAll = Number(
          (beforeAllResult.rows[0] as { count: number } | undefined)?.count ?? 0
        );
        const idsBefore = await selectIdSet(tx);

        const update: ResultSet = await tx.execute({
          sql: `
          UPDATE memories
          SET container_tag = ? || substr(container_tag, ?)
          WHERE container_tag LIKE ? ESCAPE '\\'
        `,
          args: [TO_PREFIX_WITH_SEP, FROM_PREFIX_WITH_SEP.length + 1, `${FROM_PREFIX}\\_%`],
        });

        const afterOld = await countLike(tx, FROM_PREFIX_WITH_SEP);
        const afterNew = await countLike(tx, TO_PREFIX_WITH_SEP);
        const afterAllResult: ResultSet = await tx.execute({
          sql: `SELECT COUNT(*) as count FROM memories`,
          args: [] as InArgs,
        });
        const afterAll = Number(
          (afterAllResult.rows[0] as { count: number } | undefined)?.count ?? 0
        );
        const idsAfter = await selectIdSet(tx);

        const failures: string[] = [];
        if (Number(update.rowsAffected ?? 0) !== beforeOld) {
          failures.push(
            `rewritten row count ${Number(update.rowsAffected ?? 0)} != observed ${beforeOld}`
          );
        }
        if (afterOld !== 0) {
          failures.push(`${afterOld} opencode_ rows remain`);
        }
        if (afterNew !== beforeNew + beforeOld) {
          failures.push(`omms_ count ${afterNew} != ${beforeNew} + ${beforeOld} rewritten`);
        }
        if (afterAll !== beforeAll) {
          failures.push(`row count changed: ${beforeAll} -> ${afterAll}`);
        }
        if (idsBefore.size !== idsAfter.size || ![...idsBefore].every((id) => idsAfter.has(id))) {
          failures.push("memory id set changed");
        }
        if (failures.length > 0) {
          throw new Error(
            `Container tag prefix migration verification failed for shard ` +
              `${shardLabel(target)}: ${failures.join("; ")}. ` +
              `The shard's transaction was rolled back; the migration aborted before ` +
              `writing the completion marker. Fix the cause and start again; the ` +
              `backup taken before the rewrite is untouched.`
          );
        }

        await tx.execute({
          sql: `INSERT OR REPLACE INTO ${SHARD_MARKER_TABLE} (key, value) VALUES (?, ?)`,
          args: [
            SHARD_MARKER_KEY,
            JSON.stringify({
              from: FROM_PREFIX,
              to: TO_PREFIX,
              rewritten: beforeOld,
              completedAt: new Date().toISOString(),
            }),
          ],
        });

        return { rewritten: beforeOld, skipped: false };
      });
    } catch (error) {
      // The transaction is already rolled back (TursoDb.transaction rethrows
      // after rollback). Surface every failure with the shard named so the
      // operator can find it; already-committed shards stay migrated.
      throw new Error(
        `Container tag prefix migration failed for shard ${shardLabel(target)}: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          `The shard's transaction was rolled back; the migration aborted before ` +
          `writing the completion marker. Rerun to resume; the backup taken ` +
          `before the rewrite is untouched.`,
        { cause: error }
      );
    }
  });
}

function relativeStorePath(storePath: string, filePath: string): string | null {
  const rel = relative(storePath, filePath).split("\\").join("/");
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel;
}

/**
 * Create the timestamped, checksum-verified backup of the entire store. Each
 * scope group's files are copied while holding that group's cross-process
 * write lock, so a concurrent writer in another host can never leave a shard
 * file mid-transaction in the copy. Returns the backup directory path.
 * Never deletes or modifies the backup afterwards.
 */
async function createVerifiedBackup(storePath: string, targets: ShardTarget[]): Promise<string> {
  const backupRoot = join(
    dirname(storePath),
    BACKUPS_DIR_NAME,
    `${BACKUP_SLUG_PREFIX}${timestampSlug()}`
  );
  const { files, dirs } = walkTree(storePath);
  mkdirSync(backupRoot, { recursive: true });
  for (const rel of dirs) {
    mkdirSync(join(backupRoot, rel), { recursive: true });
  }

  const filesByScope = new Map<string, string[]>();
  for (const target of targets) {
    const groupKey = `${target.scope}_${target.scopeHash}`;
    const rel = relativeStorePath(storePath, target.dbPath);
    if (rel === null) continue;
    const group = filesByScope.get(groupKey) ?? [];
    group.push(rel);
    filesByScope.set(groupKey, group);
  }
  const lockedFiles = new Set([...filesByScope.values()].flat());
  const remaining = files.filter((rel) => !lockedFiles.has(rel));

  const manifest: BackupManifestEntry[] = [];
  for (const [groupKey, relPaths] of filesByScope) {
    const [scope, scopeHash] = groupKey.split("_", 2) as ["user" | "project", string];
    const copied = await withCrossProcessWriteLock(scope, scopeHash, async () =>
      copyFilesWithVerification(storePath, backupRoot, relPaths)
    );
    manifest.push(...copied);
  }
  manifest.push(...copyFilesWithVerification(storePath, backupRoot, remaining));

  writeFileSync(
    join(backupRoot, MANIFEST_FILE),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        kind: "tag-prefix-migration",
        source: storePath,
        fileCount: manifest.length,
        files: manifest,
      },
      null,
      2
    ),
    "utf-8"
  );
  return backupRoot;
}

/**
 * Run the one-time container tag prefix migration against CONFIG.storagePath.
 * See the module comment for the safety rules. Throws on any failure; a throw
 * leaves already-committed shards migrated (resume on the next run) and the
 * completion marker absent.
 */
export async function runTagPrefixMigration(): Promise<TagPrefixMigrationResult> {
  const storePath = CONFIG.storagePath;
  if (!existsSync(storePath)) {
    mkdirSync(storePath, { recursive: true });
  }

  const metadataDb = await tursoConnectionManager.getConnection(join(storePath, METADATA_DB_NAME));
  if (await readCompletion(metadataDb)) {
    return { status: "already-migrated" };
  }

  const targets = await enumerateShardTargets(storePath);
  const preScanTotal = await countOpencodePrefixedRows(storePath);

  const releaseGate = await acquireGateLock(storePath);
  try {
    // Another process may have completed the migration while we waited for
    // the gate lock; re-read the marker before touching anything.
    if (await readCompletion(metadataDb)) {
      return { status: "already-migrated" };
    }

    if (preScanTotal === 0) {
      // Fresh store, or a crash between the last shard rewrite and the marker
      // write: the scan is the source of truth, so complete without rewriting.
      await writeCompletionMarker(metadataDb, {
        backupPath: null,
        shardsRewritten: 0,
        rowsRewritten: 0,
        startedAt: new Date().toISOString(),
      });
      return { status: "not-needed", shardsScanned: targets.length };
    }

    const startedAt = new Date().toISOString();
    const backupPath = await createVerifiedBackup(storePath, targets);

    const outcomes: TagPrefixShardOutcome[] = [];
    for (const target of targets) {
      const { rewritten, skipped } = await rewriteShard(target);
      outcomes.push({
        dbPath: target.dbPath,
        scope: target.scope,
        scopeHash: target.scopeHash,
        shardIndex: target.shardIndex,
        rewritten,
        skipped,
      });
    }

    const remaining = await countOpencodePrefixedRows(storePath);
    if (remaining !== 0) {
      throw new Error(
        `Container tag prefix migration finished with ${remaining} opencode_ row(s) still ` +
          `present in ${storePath}. No completion marker was written; rerun to resume.`
      );
    }

    const rowsRewritten = outcomes.reduce((sum, outcome) => sum + outcome.rewritten, 0);
    const shardsRewritten = outcomes.filter((outcome) => !outcome.skipped).length;
    const completedAt = new Date().toISOString();
    await writeCompletionMarker(metadataDb, {
      backupPath,
      shardsRewritten,
      rowsRewritten,
      startedAt,
    });

    log("Container tag prefix migration to omms_ complete", {
      store: storePath,
      backupPath,
      shardsScanned: targets.length,
      shardsRewritten,
      rowsRewritten,
    });

    return {
      status: "migrated",
      backupPath,
      shardsScanned: targets.length,
      shardsRewritten,
      rowsRewritten,
      shards: outcomes,
      startedAt,
      completedAt,
    };
  } finally {
    releaseGate();
  }
}

/**
 * D6 warning for an explicit `containerTagPrefix: "opencode"` override after
 * the migration: stored rows carry omms_, so the override matches no rows.
 * Pure function; returns null for every other value (including unset).
 */
export function explicitOpencodePrefixWarning(explicitPrefix: string | undefined): string | null {
  if (explicitPrefix !== FROM_PREFIX) return null;
  return (
    `containerTagPrefix is explicitly set to "opencode", but stored memory rows carry ` +
    `the "omms_" prefix after the tag migration, so the override matches no rows. ` +
    `Remove the override, or restore the pre-migration backup to roll back ` +
    `(see docs/omms-migration.md).`
  );
}

/**
 * Startup gate: before any read or write is served, migrate any remaining
 * opencode_ rows to omms_ (or abort loudly). Also emits the D6 warning once
 * per start when the config explicitly overrides the prefix to "opencode".
 * Disabled under OMMS_SKIP_TAG_PREFIX_MIGRATION=1 (set by tests/preload.ts so
 * bun test never rewrites the developer's real store).
 */
export async function runStartupTagPrefixGate(): Promise<void> {
  if (process.env.OMMS_SKIP_TAG_PREFIX_MIGRATION === "1") return;

  const completion = await readTagPrefixMigrationCompletion(CONFIG.storagePath);
  if (!completion) {
    const report = await runTagPrefixMigration();
    log(`Tag prefix migration gate: ${report.status}`);
  }

  const warning = explicitOpencodePrefixWarning(getExplicitContainerTagPrefix());
  if (warning) {
    log(warning);
  }
}
