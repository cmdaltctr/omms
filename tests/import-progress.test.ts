import { describe, expect, it } from "bun:test";
import {
  addProgressSample,
  estimateProgress,
  MAX_PROGRESS_SAMPLES,
  workProgress,
  type ProgressSample,
} from "../src/importer/import-progress.js";

describe("import progress estimate", () => {
  it("shows 40% and about 120 minutes left at 400 of 1,000 and 5 a minute", () => {
    const samples: ProgressSample[] = [0, 1, 2, 3, 4].map((minute) => ({
      at: minute * 60_000,
      done: 380 + minute * 5,
    }));
    expect(estimateProgress(1000, 400, samples)).toEqual({
      percent: 40,
      minutesLeft: 120,
      ratePerMinute: 5,
    });
  });

  it("is unknown until 5 samples over 60 seconds", () => {
    const four = [0, 1, 2, 3].map((i) => ({ at: i * 60_000, done: i * 10 }));
    expect(estimateProgress(100, 30, four).minutesLeft).toBeNull();
    const quick = [0, 1, 2, 3, 4].map((i) => ({ at: i * 1_000, done: i * 10 }));
    expect(estimateProgress(100, 40, quick)).toEqual({
      percent: 40,
      minutesLeft: null,
      ratePerMinute: null,
    });
  });

  it("uses only the most recent samples", () => {
    let samples: ProgressSample[] = [];
    for (let i = 0; i < 30; i++) samples = addProgressSample(samples, { at: i, done: i });
    expect(samples).toHaveLength(MAX_PROGRESS_SAMPLES);
    expect(samples[0]).toEqual({ at: 10, done: 10 });
  });
});

describe("finished work units", () => {
  it("leaves ledger hits out and counts a unit only once it has finished", () => {
    // P1 starts; nothing finished yet.
    expect(workProgress(1, 10, 0)).toEqual({ done: 0, total: 10 });
    // A ledger hit starts after P1 finished.
    expect(workProgress(2, 10, 0)).toEqual({ done: 1, total: 10 });
    // P2 starts; the hit is now counted as already handled.
    expect(workProgress(3, 10, 1)).toEqual({ done: 1, total: 9 });
    // 729 of 736 in the ledger, the backfill's dry run said 7.
    expect(workProgress(736, 736, 728, 7)).toEqual({ done: 7, total: 7 });
    expect(workProgress(740, 736, 728, 7).done).toBe(7);
  });
});
