import { existsSync } from "node:fs";
import { join } from "node:path";
import { tursoConnectionManager } from "../turso/connection-manager.js";
import { HOSTS } from "../../shared/hosts.js";
import type { BackfillHost } from "../../utils/backfill-model.js";
import { getStoragePath } from "./active-space-access.js";

/**
 * The `import_runs` table in import-ledger.db: one row per host with the
 * latest history import run. Only numbers, the surface, the PID and a
 * redacted error are stored; conversation content never is.
 */

export type ImportSurface = "auto" | "web" | "cli" | "slash";
export type ImportRunState = "running" | "paused" | "stopped" | "done" | "failed";
/**
 * A run imports exchanges first, then learns the profile from the imported
 * prompts. A run without memories that records skill turns starts in
 * `skill-turns` instead of `exchanges`.
 */
export type ImportRunPhase = "exchanges" | "skill-turns" | "profile";

export interface ImportRunCounts {
  total: number;
  done: number;
  imported: number;
  skipped: number;
  failed: number;
}

/** A stored run as it is on disk. `state` is not checked against the process. */
export interface ImportRunRow extends ImportRunCounts {
  surface: ImportSurface | null;
  state: ImportRunState | null;
  pid: number | null;
  startedAt: number | null;
  updatedAt: number | null;
  error: string | null;
  paused: boolean;
  phase: ImportRunPhase;
  profileDone: number;
  profileTotal: number;
  /** The progress samples as stored JSON, or null. */
  samples: string | null;
}

const dbPath = () => join(getStoragePath(), "import-ledger.db");

async function table() {
  const db = await tursoConnectionManager.getConnection(dbPath());
  await db.run(`CREATE TABLE IF NOT EXISTS import_runs (
    host TEXT PRIMARY KEY, surface TEXT, state TEXT, pid INTEGER, started_at INTEGER,
    total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
    imported INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at INTEGER,
    samples TEXT, paused INTEGER NOT NULL DEFAULT 0
  )`);
  for (const column of [
    "phase TEXT",
    "profile_done INTEGER NOT NULL DEFAULT 0",
    "profile_total INTEGER NOT NULL DEFAULT 0",
  ]) {
    try {
      await db.run(`ALTER TABLE import_runs ADD COLUMN ${column}`);
    } catch (error) {
      if (!String((error as Error)?.message ?? error).includes("duplicate column")) throw error;
    }
  }
  // A row per host keeps every later statement a plain UPDATE. The ids are bound, never spliced.
  await db.run(
    `INSERT OR IGNORE INTO import_runs (host) VALUES ${HOSTS.map(() => "(?)").join(", ")}`,
    [...HOSTS]
  );
  return db;
}

/** Read a host's stored run without creating the store or the table. */
export async function readImportRunRow(host: BackfillHost): Promise<ImportRunRow | null> {
  if (!existsSync(dbPath())) return null;
  const db = await tursoConnectionManager.getConnection(dbPath());
  const exists = await db.get(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'import_runs'"
  );
  if (!exists) return null;
  const row = await db.get<Record<string, unknown>>("SELECT * FROM import_runs WHERE host = ?", [
    host,
  ]);
  if (!row) return null;
  return {
    surface: (row.surface ?? null) as ImportSurface | null,
    state: (row.state ?? null) as ImportRunState | null,
    pid: row.pid === null ? null : Number(row.pid),
    startedAt: row.started_at === null ? null : Number(row.started_at),
    updatedAt: row.updated_at === null ? null : Number(row.updated_at),
    total: Number(row.total),
    done: Number(row.done),
    imported: Number(row.imported),
    skipped: Number(row.skipped),
    failed: Number(row.failed),
    error: row.error === null ? null : String(row.error),
    paused: Number(row.paused) === 1,
    phase: row.phase === "profile" || row.phase === "skill-turns" ? row.phase : "exchanges",
    profileDone: Number(row.profile_done ?? 0),
    profileTotal: Number(row.profile_total ?? 0),
    samples: row.samples ? String(row.samples) : null,
  };
}

export async function setBackfillPaused(host: BackfillHost, paused: boolean): Promise<void> {
  const db = await table();
  await db.run("UPDATE import_runs SET paused = ?, updated_at = ? WHERE host = ?", [
    paused ? 1 : 0,
    Date.now(),
    host,
  ]);
}

/**
 * Writes for one run. It keeps the connection it opened at the start, so a
 * run writes to the store it started in. Each write returns the paused flag.
 * Callers pass counts already checked.
 */
export interface ImportRunWriter {
  progress(total: number, done: number, samples: string, now: number): Promise<boolean>;
  profileProgress(done: number, total: number, now: number): Promise<boolean>;
  finish(
    state: Exclude<ImportRunState, "running">,
    counts: ImportRunCounts,
    error: string | null,
    now: number
  ): Promise<void>;
}

/** Reset a host's row to a new running run. */
export async function beginImportRun(
  host: BackfillHost,
  run: { surface: ImportSurface; pid: number; startedAt: number; phase: ImportRunPhase }
): Promise<ImportRunWriter> {
  const db = await table();
  await db.run(
    `UPDATE import_runs SET surface = ?, state = 'running', pid = ?, started_at = ?, total = 0,
       done = 0, imported = 0, skipped = 0, failed = 0, error = NULL, updated_at = ?, samples = '[]',
       phase = ?, profile_done = 0, profile_total = 0
     WHERE host = ?`,
    [run.surface, run.pid, run.startedAt, run.startedAt, run.phase, host]
  );
  const paused = async () => {
    const row = await db.get<{ paused: number }>("SELECT paused FROM import_runs WHERE host = ?", [
      host,
    ]);
    return Number(row?.paused) === 1;
  };
  return {
    async progress(total, done, samples, now) {
      await db.run(
        "UPDATE import_runs SET total = ?, done = ?, samples = ?, updated_at = ? WHERE host = ?",
        [total, done, samples, now, host]
      );
      return paused();
    },
    async profileProgress(done, total, now) {
      await db.run(
        `UPDATE import_runs SET phase = 'profile', profile_done = ?, profile_total = ?,
               updated_at = ? WHERE host = ?`,
        [done, total, now, host]
      );
      return paused();
    },
    async finish(state, counts, error, now) {
      await db.run(
        `UPDATE import_runs SET state = ?, total = ?, done = ?, imported = ?, skipped = ?,
           failed = ?, error = ?, updated_at = ? WHERE host = ?`,
        [
          state,
          counts.total,
          counts.done,
          counts.imported,
          counts.skipped,
          counts.failed,
          error,
          now,
          host,
        ]
      );
    },
  };
}
