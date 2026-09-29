import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "../config.js";
import { safeHealthError } from "../services/safe-health-error.js";
import { tursoConnectionManager } from "../services/turso/connection-manager.js";
import type { BackfillHost } from "./backfill-model.js";
import { isProcessAlive } from "./backfill-lock.js";
import {
  addProgressSample,
  estimateProgress,
  type ProgressEstimate,
  type ProgressSample,
} from "./import-progress.js";

export type ImportSurface = "auto" | "web" | "cli" | "slash";
export type ImportRunState = "running" | "paused" | "stopped" | "done" | "failed";

export interface ImportRunCounts {
  total: number;
  done: number;
  imported: number;
  skipped: number;
  failed: number;
}

export interface ImportRun extends ImportRunCounts, ProgressEstimate {
  host: BackfillHost;
  surface: ImportSurface | null;
  state: ImportRunState | null;
  pid: number | null;
  startedAt: number | null;
  updatedAt: number | null;
  error: string | null;
  /** The user paused this host's backfill; automatic runs wait for Resume. */
  paused: boolean;
}

const dbPath = (storagePath = CONFIG.storagePath) => join(storagePath, "import-ledger.db");

async function table(storagePath?: string) {
  const db = await tursoConnectionManager.getConnection(dbPath(storagePath));
  await db.run(`CREATE TABLE IF NOT EXISTS import_runs (
    host TEXT PRIMARY KEY, surface TEXT, state TEXT, pid INTEGER, started_at INTEGER,
    total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
    imported INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at INTEGER,
    samples TEXT, paused INTEGER NOT NULL DEFAULT 0
  )`);
  // A row per host keeps every later statement a plain UPDATE.
  await db.run(
    "INSERT OR IGNORE INTO import_runs (host) VALUES ('pi'), ('opencode'), ('claude-code')"
  );
  return db;
}

const count = (value: number) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** Read a host's run without creating the store; a running row whose process is gone reads as stopped. */
export async function readImportRun(host: BackfillHost): Promise<ImportRun | null> {
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
  const pid = row.pid === null ? null : Number(row.pid);
  let state = (row.state ?? null) as ImportRunState | null;
  if (state === "running" && (pid === null || !isProcessAlive(pid))) state = "stopped";
  const total = Number(row.total);
  const done = Number(row.done);
  const samples = row.samples ? (JSON.parse(String(row.samples)) as ProgressSample[]) : [];
  return {
    host,
    surface: (row.surface ?? null) as ImportSurface | null,
    state,
    pid,
    startedAt: row.started_at === null ? null : Number(row.started_at),
    updatedAt: row.updated_at === null ? null : Number(row.updated_at),
    total,
    done,
    imported: Number(row.imported),
    skipped: Number(row.skipped),
    failed: Number(row.failed),
    error: row.error === null ? null : String(row.error),
    paused: Number(row.paused) === 1,
    ...(state === "running"
      ? estimateProgress(total, done, samples)
      : {
          percent: total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0,
          minutesLeft: null,
          ratePerMinute: null,
        }),
  };
}

export async function isBackfillPaused(host: BackfillHost): Promise<boolean> {
  return (await readImportRun(host))?.paused ?? false;
}

export async function setBackfillPaused(host: BackfillHost, paused: boolean): Promise<void> {
  const db = await table();
  await db.run("UPDATE import_runs SET paused = ?, updated_at = ? WHERE host = ?", [
    paused ? 1 : 0,
    Date.now(),
    host,
  ]);
}

export interface ImportRunRecorder {
  /** Feed from `onProgress`; writes at most once per interval and checks the paused flag. */
  progress(done: number, total: number): void;
  /** True after a progress write saw the paused flag. */
  readonly pauseRequested: boolean;
  finish(
    state: Exclude<ImportRunState, "running">,
    counts: Partial<ImportRunCounts>,
    error?: unknown
  ): Promise<void>;
}

/**
 * Start a host's run record. Only numbers, the surface, and the PID are
 * stored; `promptPreview` and all other conversation content never are.
 */
export async function startImportRun(
  host: BackfillHost,
  surface: ImportSurface,
  options: {
    now?: () => number;
    intervalMs?: number;
    sampleIntervalMs?: number;
    onPause?: () => void;
  } = {}
): Promise<ImportRunRecorder> {
  const clock = options.now ?? Date.now;
  const interval = options.intervalMs ?? 1_000;
  const sampleInterval = options.sampleIntervalMs ?? 15_000;
  const db = await table();
  const startedAt = clock();
  await db.run(
    `UPDATE import_runs SET surface = ?, state = 'running', pid = ?, started_at = ?, total = 0,
       done = 0, imported = 0, skipped = 0, failed = 0, error = NULL, updated_at = ?, samples = '[]'
     WHERE host = ?`,
    [surface, process.pid, startedAt, startedAt, host]
  );
  let samples: ProgressSample[] = [];
  let lastWrite = Number.NEGATIVE_INFINITY;
  let lastSample = Number.NEGATIVE_INFINITY;
  let latest = { done: 0, total: 0 };
  let pauseRequested = false;
  let writing: Promise<void> = Promise.resolve();
  const write = () => {
    const now = clock();
    lastWrite = now;
    // Sample less often than we write, so the window spans minutes, not seconds.
    if (now - lastSample >= sampleInterval) {
      lastSample = now;
      samples = addProgressSample(samples, { at: now, done: latest.done });
    }
    const snapshot = { ...latest, samples: JSON.stringify(samples) };
    writing = writing
      .then(async () => {
        await db.run(
          "UPDATE import_runs SET total = ?, done = ?, samples = ?, updated_at = ? WHERE host = ?",
          [count(snapshot.total), count(snapshot.done), snapshot.samples, now, host]
        );
        const row = await db.get<{ paused: number }>(
          "SELECT paused FROM import_runs WHERE host = ?",
          [host]
        );
        if (Number(row?.paused) === 1 && !pauseRequested) {
          pauseRequested = true;
          options.onPause?.();
        }
      })
      .catch(() => {});
  };
  return {
    progress(done, total) {
      latest = { done, total };
      if (clock() - lastWrite >= interval) write();
    },
    get pauseRequested() {
      return pauseRequested;
    },
    async finish(state, counts, error) {
      await writing;
      await db.run(
        `UPDATE import_runs SET state = ?, total = ?, done = ?, imported = ?, skipped = ?,
           failed = ?, error = ?, updated_at = ? WHERE host = ?`,
        [
          state,
          count(counts.total ?? latest.total),
          count(counts.done ?? latest.done),
          count(counts.imported ?? 0),
          count(counts.skipped ?? 0),
          count(counts.failed ?? 0),
          error == null ? null : safeHealthError(error, [CONFIG.memoryApiKey]).slice(0, 500),
          clock(),
          host,
        ]
      );
    },
  };
}
