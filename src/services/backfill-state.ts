import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "../config.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import { safeHealthError } from "./safe-health-error.js";

type BackfillHost = "pi" | "opencode";
const importLedgerDbPath = () => join(CONFIG.storagePath, "import-ledger.db");

export type BackfillStatus = {
  host: BackfillHost;
  cutoff: number;
  state: "not-started" | "running" | "stopped" | "done" | "failed";
  model: string | null;
  counts: {
    imported: number;
    skipped: number;
    failed: number;
    pending: number;
    unresolved: number;
  };
  error: string | null;
  updatedAt: number;
};

const emptyCounts = () => ({ imported: 0, skipped: 0, failed: 0, pending: 0, unresolved: 0 });

async function table() {
  const db = await tursoConnectionManager.getConnection(importLedgerDbPath());
  await db.run(`CREATE TABLE IF NOT EXISTS backfill_state (
    host TEXT PRIMARY KEY, cutoff INTEGER NOT NULL, state TEXT,
    model TEXT, counts TEXT, error TEXT, updated_at INTEGER
  )`);
  return db;
}

/** Record a fixed per-host cutoff before the first import. */
export async function getBackfillCutoff(host: BackfillHost, now = Date.now()): Promise<number> {
  const db = await table();
  await db.run(
    `INSERT OR IGNORE INTO backfill_state (host, cutoff, state, counts, updated_at)
     VALUES (?, ?, 'not-started', ?, ?)`,
    [host, now, JSON.stringify(emptyCounts()), now]
  );
  const row = await db.get<{ cutoff: number }>("SELECT cutoff FROM backfill_state WHERE host = ?", [
    host,
  ]);
  return Number(row!.cutoff);
}

/** Read progress without creating a store or a ledger table. */
export async function readBackfillStatus(host: BackfillHost): Promise<BackfillStatus | null> {
  if (!existsSync(importLedgerDbPath())) return null;
  const db = await tursoConnectionManager.getConnection(importLedgerDbPath());
  const exists = await db.get(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'backfill_state'"
  );
  if (!exists) return null;
  const row = await db.get<Record<string, unknown>>("SELECT * FROM backfill_state WHERE host = ?", [
    host,
  ]);
  if (!row) return null;
  return {
    host,
    cutoff: Number(row.cutoff),
    state: row.state as BackfillStatus["state"],
    model: row.model === null ? null : String(row.model),
    counts: row.counts
      ? (JSON.parse(String(row.counts)) as BackfillStatus["counts"])
      : emptyCounts(),
    error: row.error === null ? null : String(row.error),
    updatedAt: Number(row.updated_at),
  };
}

/** Save only numeric counts and a redacted error, never report units or prompts. */
export async function updateBackfillStatus(
  host: BackfillHost,
  update: Pick<BackfillStatus, "state" | "model" | "counts"> & { error?: unknown }
): Promise<void> {
  const counts = Object.fromEntries(
    (Object.keys(emptyCounts()) as Array<keyof BackfillStatus["counts"]>).map((key) => [
      key,
      Number.isSafeInteger(update.counts[key]) && update.counts[key] >= 0 ? update.counts[key] : 0,
    ])
  );
  const db = await table();
  await db.run(
    `UPDATE backfill_state SET state = ?, model = ?, counts = ?, error = ?, updated_at = ? WHERE host = ?`,
    [
      update.state,
      update.model,
      JSON.stringify(counts),
      update.error == null
        ? null
        : safeHealthError(update.error, [CONFIG.memoryApiKey]).slice(0, 500),
      Date.now(),
      host,
    ]
  );
}
