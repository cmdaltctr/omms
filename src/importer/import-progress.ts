/** One `(time, done)` reading of a running import. */
export interface ProgressSample {
  at: number;
  done: number;
}

export const MAX_PROGRESS_SAMPLES = 20;
const MIN_SAMPLES = 5;
const MIN_WINDOW_MS = 60_000;

/** Keep the most recent samples; a sample with no new units only moves the clock. */
export function addProgressSample(
  samples: readonly ProgressSample[],
  sample: ProgressSample
): ProgressSample[] {
  return [...samples, sample].slice(-MAX_PROGRESS_SAMPLES);
}

export interface ProgressEstimate {
  percent: number;
  /** Null until the recent window has 5 samples spanning a minute and a non-zero rate. */
  minutesLeft: number | null;
  /** Units a minute over the recent window, or null while unknown. */
  ratePerMinute: number | null;
}

/** Percentage done and minutes left from the recent sample window, not the whole run. */
export function estimateProgress(
  total: number,
  done: number,
  samples: readonly ProgressSample[]
): ProgressEstimate {
  const percent = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  if (samples.length < MIN_SAMPLES) return { percent, minutesLeft: null, ratePerMinute: null };
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const span = last.at - first.at;
  if (span < MIN_WINDOW_MS || last.done <= first.done) {
    return { percent, minutesLeft: null, ratePerMinute: null };
  }
  const ratePerMinute = (last.done - first.done) / (span / 60_000);
  return {
    percent,
    minutesLeft: Math.max(0, Math.round((total - done) / ratePerMinute)),
    ratePerMinute,
  };
}

/**
 * Turn the importer's progress callback into finished work units. The
 * importer reports a unit as it starts, and `alreadyHandled` (units found in
 * the ledger, which need no model call) does not yet include that unit, so
 * finished work is `processed - 1 - alreadyHandled`.
 */
export function workProgress(
  processed: number,
  total: number,
  alreadyHandled = 0,
  expectedTotal?: number
): { done: number; total: number } {
  const workTotal = Math.max(0, expectedTotal ?? total - alreadyHandled);
  return {
    done: Math.min(workTotal, Math.max(0, processed - 1 - alreadyHandled)),
    total: workTotal,
  };
}
