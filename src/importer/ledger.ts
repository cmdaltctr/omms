import { join } from "node:path";
import { CONFIG } from "../config.js";
import { tursoConnectionManager } from "../services/turso/connection-manager.js";

/**
 * Durable ledger for historical-session imports across hosts.
 *
 * One row per deterministic import key. Records terminal states so reruns
 * never reprocess handled work, plus in-progress states so a crash between
 * the memory insert and the ledger write can be reconciled against the stored
 * import identity instead of inserting a duplicate.
 *
 * The ledger lives inside `storagePath` (import-ledger.db) so idempotency
 * travels with the memory store on machine moves.
 */

export const IMPORT_LEDGER_DB_NAME = "import-ledger.db";

export type ImportLedgerStatus = "in-progress" | "imported" | "skipped" | "failed";

export interface ImportLedgerRow {
  key: string;
  sessionId: string;
  sourceFile: string;
  projectHash: string;
  status: ImportLedgerStatus;
  memoryId: string | null;
  skipReason: string | null;
  updatedAt: number;
}

export function importLedgerDbPath(storagePath: string = CONFIG.storagePath): string {
  return join(storagePath, IMPORT_LEDGER_DB_NAME);
}

function rowToEntry(row: Record<string, unknown>): ImportLedgerRow {
  return {
    key: String(row.key),
    sessionId: String(row.session_id),
    sourceFile: String(row.source_file),
    projectHash: String(row.project_hash),
    status: row.status as ImportLedgerStatus,
    memoryId: row.memory_id === null || row.memory_id === undefined ? null : String(row.memory_id),
    skipReason:
      row.skip_reason === null || row.skip_reason === undefined ? null : String(row.skip_reason),
    updatedAt: Number(row.updated_at),
  };
}

export class ImportLedger {
  private initPromise: Promise<void> | null = null;

  private async ready(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const db = await tursoConnectionManager.getConnection(importLedgerDbPath());
      await db.batch([
        {
          sql: `
            CREATE TABLE IF NOT EXISTS import_ledger (
              key TEXT PRIMARY KEY,
              session_id TEXT NOT NULL,
              source_file TEXT NOT NULL,
              project_hash TEXT NOT NULL,
              status TEXT NOT NULL,
              memory_id TEXT,
              skip_reason TEXT,
              updated_at INTEGER NOT NULL
            )
          `,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_import_ledger_session ON import_ledger(session_id)`,
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS idx_import_ledger_status ON import_ledger(status)`,
        },
      ]);
    })();
    try {
      await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  private async db() {
    await this.ready();
    return tursoConnectionManager.getConnection(importLedgerDbPath());
  }

  async get(key: string): Promise<ImportLedgerRow | null> {
    const db = await this.db();
    const row = await db.get(`SELECT * FROM import_ledger WHERE key = ?`, [key]);
    return row ? rowToEntry(row) : null;
  }

  /**
   * Read-only lookup for dry runs: never creates the table or its indexes.
   * A ledger file without the table reads as empty.
   */
  async peek(key: string): Promise<ImportLedgerRow | null> {
    const db = await tursoConnectionManager.getConnection(importLedgerDbPath());
    const table = await db.get(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'import_ledger'`
    );
    if (!table) return null;
    const row = await db.get(`SELECT * FROM import_ledger WHERE key = ?`, [key]);
    return row ? rowToEntry(row) : null;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const db = await this.db();
    const rows = await db.all(
      `SELECT status, COUNT(*) AS count FROM import_ledger GROUP BY status`
    );
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[String(row.status)] = Number(row.count);
    }
    return counts;
  }

  /** Upsert an in-progress marker before processing a unit. */
  async begin(input: {
    key: string;
    sessionId: string;
    sourceFile: string;
    projectHash: string;
  }): Promise<void> {
    const db = await this.db();
    await db.run(
      `
        INSERT INTO import_ledger (key, session_id, source_file, project_hash, status, memory_id, skip_reason, updated_at)
        VALUES (?, ?, ?, ?, 'in-progress', NULL, NULL, ?)
        ON CONFLICT(key) DO UPDATE SET
          status = 'in-progress',
          memory_id = NULL,
          skip_reason = NULL,
          updated_at = excluded.updated_at
      `,
      [input.key, input.sessionId, input.sourceFile, input.projectHash, Date.now()]
    );
  }

  /** Terminal success: a memory row exists for the key. */
  async complete(key: string, memoryId: string): Promise<void> {
    const db = await this.db();
    await db.run(
      `
        INSERT INTO import_ledger (key, session_id, source_file, project_hash, status, memory_id, skip_reason, updated_at)
        VALUES (?, '', '', '', 'imported', ?, NULL, ?)
        ON CONFLICT(key) DO UPDATE SET
          status = 'imported',
          memory_id = excluded.memory_id,
          skip_reason = NULL,
          updated_at = excluded.updated_at
      `,
      [key, memoryId, Date.now()]
    );
  }

  /** Terminal skip (for example deterministic extractor skip): never reprocess. */
  async skip(key: string, reason: string): Promise<void> {
    const db = await this.db();
    await db.run(
      `
        INSERT INTO import_ledger (key, session_id, source_file, project_hash, status, memory_id, skip_reason, updated_at)
        VALUES (?, '', '', '', 'skipped', NULL, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          status = 'skipped',
          skip_reason = excluded.skip_reason,
          updated_at = excluded.updated_at
      `,
      [key, reason, Date.now()]
    );
  }

  /** Retryable failure: the unit is reprocessed on the next run. */
  async fail(key: string, error: string): Promise<void> {
    const db = await this.db();
    await db.run(
      `
        INSERT INTO import_ledger (key, session_id, source_file, project_hash, status, memory_id, skip_reason, updated_at)
        VALUES (?, '', '', '', 'failed', NULL, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          status = 'failed',
          skip_reason = excluded.skip_reason,
          updated_at = excluded.updated_at
      `,
      [key, error, Date.now()]
    );
  }
}

/** Backwards-compatible name for existing Pi imports. */
export { ImportLedger as PiImportLedger };
