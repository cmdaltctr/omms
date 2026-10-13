import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserProfilePreference } from "../src/services/user-profile/types.js";

type ConflictHarness = {
  detectConflicts(items: UserProfilePreference[], type: string, profileId: string): Promise<void>;
  checkConflict(a: string, b: string): Promise<boolean>;
};
let directory: string;

async function manager(): Promise<ConflictHarness> {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = directory;
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  return new UserProfileManager() as unknown as ConflictHarness;
}

/** Eight candidate pairs with the base; other pairs score 0.64, below the conflict band. */
function items(): UserProfilePreference[] {
  return Array.from({ length: 9 }, (_, index) => {
    const centroid = Array<number>(9).fill(0);
    centroid[0] = index === 0 ? 1 : 0.8;
    if (index > 0) centroid[index] = 0.6;
    return {
      category: "Testing",
      description: `Synthetic preference ${index}`,
      confidence: 0.6,
      frequency: index === 0 ? 10 : 1,
      alpha: 2,
      beta: 1,
      evidence: [],
      lastSeen: 123,
      centroid,
      anchor: centroid,
    };
  });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-conflict-limit-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("profile conflict call limit", () => {
  it("stops after three negative answers and preserves positive conflict handling", async () => {
    const store = await manager();
    const input = items();
    const before = structuredClone(input);
    const negative = mock(async () => false);
    store.checkConflict = negative;
    await store.detectConflicts(input, "preference", "synthetic-profile");
    expect(negative).toHaveBeenCalledTimes(3);
    expect(input).toEqual(before);

    const positive = mock(async () => true);
    store.checkConflict = positive;
    const confirmed = items();
    await store.detectConflicts(confirmed, "preference", "synthetic-profile");
    expect(positive).toHaveBeenCalledTimes(3);
    expect(confirmed).toHaveLength(6);
    expect(confirmed[0]!.frequency).toBe(13);
  });

  it("counts negative and positive answers within the same three-call budget", async () => {
    const store = await manager();
    let calls = 0;
    const check = mock(async () => ++calls === 3);
    store.checkConflict = check;
    const input = items();
    await store.detectConflicts(input, "pattern", "synthetic-profile");
    expect(check).toHaveBeenCalledTimes(3);
    expect(input).toHaveLength(8);
    expect(input[0]!.frequency).toBe(11);
  });
});
