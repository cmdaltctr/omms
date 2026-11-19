import { CONFIG } from "../config.js";
import { safeHealthError } from "../services/safe-health-error.js";
import {
  beginImportRun,
  readImportRunRow,
  type ImportRunCounts,
  type ImportRunPhase,
  type ImportRunState,
  type ImportSurface,
} from "../services/storage/import-runs.js";
import type { BackfillHost } from "../utils/backfill-model.js";
import { isProcessAlive } from "../services/storage/backfill-locks.js";
import {
  addProgressSample,
  estimateProgress,
  type ProgressEstimate,
  type ProgressSample,
} from "./import-progress.js";

export { setBackfillPaused } from "../services/storage/import-runs.js";
export type {
  ImportRunCounts,
  ImportRunPhase,
  ImportRunState,
  ImportSurface,
} from "../services/storage/import-runs.js";

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
  phase: ImportRunPhase;
  /** Profile batches done and planned, while `phase` is `profile`. */
  profileDone: number;
  profileTotal: number;
}

const count = (value: number) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** Read a host's run without creating the store; a running row whose process is gone reads as stopped. */
export async function readImportRun(host: BackfillHost): Promise<ImportRun | null> {
  const row = await readImportRunRow(host);
  if (!row) return null;
  const { samples: storedSamples, ...stored } = row;
  let state = stored.state;
  if (state === "running" && (stored.pid === null || !isProcessAlive(stored.pid)))
    state = "stopped";
  const { total, done } = stored;
  const samples = storedSamples ? (JSON.parse(storedSamples) as ProgressSample[]) : [];
  return {
    host,
    ...stored,
    state,
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

export interface ImportRunRecorder {
  /** Feed from `onProgress`; writes at most once per interval and checks the paused flag. */
  progress(done: number, total: number): void;
  /** Feed from the profile step: batches done and planned. Moves the run to the profile phase. */
  profileProgress(done: number, total: number): void;
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
    /** The first phase; `exchanges` unless the run records skill turns only. */
    phase?: Exclude<ImportRunPhase, "profile">;
  } = {}
): Promise<ImportRunRecorder> {
  const clock = options.now ?? Date.now;
  const interval = options.intervalMs ?? 1_000;
  const sampleInterval = options.sampleIntervalMs ?? 15_000;
  const startedAt = clock();
  const writer = await beginImportRun(host, {
    surface,
    pid: process.pid,
    startedAt,
    phase: options.phase ?? "exchanges",
  });
  let samples: ProgressSample[] = [];
  let lastWrite = Number.NEGATIVE_INFINITY;
  let lastSample = Number.NEGATIVE_INFINITY;
  let latest = { done: 0, total: 0 };
  let pauseRequested = false;
  let writing: Promise<void> = Promise.resolve();
  const notePaused = (paused: boolean) => {
    if (paused && !pauseRequested) {
      pauseRequested = true;
      options.onPause?.();
    }
  };
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
      .then(async () =>
        notePaused(
          await writer.progress(count(snapshot.total), count(snapshot.done), snapshot.samples, now)
        )
      )
      .catch(() => {});
  };
  return {
    progress(done, total) {
      latest = { done, total };
      if (clock() - lastWrite >= interval) write();
    },
    profileProgress(done, total) {
      const now = clock();
      writing = writing
        .then(async () => notePaused(await writer.profileProgress(count(done), count(total), now)))
        .catch(() => {});
    },
    get pauseRequested() {
      return pauseRequested;
    },
    async finish(state, counts, error) {
      await writing;
      await writer.finish(
        state,
        {
          total: count(counts.total ?? latest.total),
          done: count(counts.done ?? latest.done),
          imported: count(counts.imported ?? 0),
          skipped: count(counts.skipped ?? 0),
          failed: count(counts.failed ?? 0),
        },
        error == null ? null : safeHealthError(error, [CONFIG.memoryApiKey]).slice(0, 500),
        clock()
      );
    },
  };
}
