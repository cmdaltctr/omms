import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";

// Characterisation tests for duplicate removal in UserProfileManager.mergeProfileData.
// The model checks are replaced on the instance, as profile-conflict-call-limit.test.ts does.

let tmpDir: string;

type Harness = {
  mergeProfileData(existing: any, updates: any, embed?: any, profileId?: string): Promise<any>;
  checkSemanticDuplicate(a: string, b: string): Promise<boolean>;
  checkConflict(a: string, b: string): Promise<boolean>;
};

async function makeManager(duplicate: (a: string, b: string) => boolean) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = tmpDir;
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  const mgr = new UserProfileManager() as unknown as Harness;
  const calls: string[][] = [];
  const conflictCalls: string[][] = [];
  mgr.checkSemanticDuplicate = async (a, b) => {
    calls.push([a, b]);
    return duplicate(a, b);
  };
  mgr.checkConflict = async (a, b) => {
    conflictCalls.push([a, b]);
    return false;
  };
  return { mgr, calls, conflictCalls };
}

const DIMS = 8;

function vec(...components: number[]): number[] {
  const v = new Array(DIMS).fill(0);
  components.forEach((c, i) => (v[i] = c));
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  return v.map((x) => x / norm);
}

function item(category: string, description: string, centroid: number[], extra = {}) {
  return {
    category,
    description,
    alpha: 2,
    beta: 1,
    weakAlpha: 1,
    weakBeta: 1,
    confidence: 0.6,
    frequency: 1,
    lastSeen: 1_000,
    lastMatchTime: 1_000,
    firstSeen: 1_000,
    evidence: [] as string[],
    pendingValidation: false,
    centroid,
    anchor: centroid,
    ...extra,
  };
}

const profile = (preferences: any[]) => ({ preferences, patterns: [], workflows: [] });
const cold = { isWarmedUp: false } as any;

describe("user profile manager duplicate removal", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omms-upm-dedupe-"));
  });

  afterEach(async () => {
    await tursoConnectionManager.closeAll();
    await new Promise((r) => setTimeout(r, 50));
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore leftover test files
    }
  });

  it("folds a confirmed duplicate into the more frequent item", async () => {
    const { mgr, calls, conflictCalls } = await makeManager(() => true);
    const keeper = item("Style", "Prefers tabs", vec(1, 0.1), {
      frequency: 3,
      alpha: 4,
      beta: 2,
      weakAlpha: 2,
      evidence: ["k1"],
      lastSeen: 2_000,
      pendingValidation: true,
    });
    const removed = item("Style", "Likes tab indents", vec(1, 0.2), {
      frequency: 2,
      alpha: 3,
      beta: 1.5,
      weakBeta: 3,
      evidence: ["r1", "k1"],
      lastMatchTime: 5_000,
    });

    const merged = await mgr.mergeProfileData(profile([removed, keeper]), {}, cold, "p1");

    expect(conflictCalls).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(merged.preferences).toHaveLength(1);
    const kept = merged.preferences[0];
    expect(kept.description).toBe("Prefers tabs");
    expect(kept.frequency).toBe(5);
    expect(kept.alpha).toBe(7);
    expect(kept.beta).toBe(3.5);
    expect(kept.weakAlpha).toBe(2);
    expect(kept.weakBeta).toBe(3);
    expect(kept.lastSeen).toBe(2_000);
    expect(kept.lastMatchTime).toBe(5_000);
    expect(kept.evidence).toEqual(["k1", "r1"]);
    expect(kept.pendingValidation).toBe(false);
  });

  it("keeps both items and skips the same pair next time when the model says no", async () => {
    const { mgr, calls } = await makeManager(() => false);
    const a = item("Style", "Prefers tabs", vec(1, 0.1));
    const b = item("Style", "Likes tab indents", vec(1, 0.2));

    const first = await mgr.mergeProfileData(profile([a, b]), {}, cold, "p1");
    expect(first.preferences).toHaveLength(2);
    expect(calls).toHaveLength(1);

    const second = await mgr.mergeProfileData(profile([a, b]), {}, cold, "p1");
    expect(second.preferences).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });

  it("asks the model at most five times in one pass", async () => {
    const { mgr, calls } = await makeManager(() => false);
    const items = Array.from({ length: 7 }, (_, i) =>
      item("Style", `Tab preference number ${i}`, vec(1, 0.01 * (i + 1)))
    );

    const merged = await mgr.mergeProfileData(profile(items), {}, cold, "p1");

    expect(merged.preferences).toHaveLength(7);
    expect(calls).toHaveLength(5);
  });

  it("never compares items in different categories or without a profile id", async () => {
    const { mgr, calls } = await makeManager(() => true);
    const a = item("Style", "Prefers tabs", vec(1, 0.1));
    const b = item("Editor", "Likes tab indents", vec(1, 0.2));

    const split = await mgr.mergeProfileData(profile([a, b]), {}, cold, "p1");
    expect(split.preferences).toHaveLength(2);

    const c = item("Style", "Likes tab indents", vec(1, 0.2));
    const anonymous = await mgr.mergeProfileData(profile([a, c]), {}, cold);
    expect(anonymous.preferences).toHaveLength(2);
    expect(calls).toEqual([]);
  });
});
