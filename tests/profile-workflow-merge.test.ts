import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";

let tmpDir: string;

async function makeManager() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = tmpDir;
  CONFIG.userProfileEmbeddingMinDescriptionLength = 5;
  CONFIG.userProfileEmbeddingThresholdSameCat = 0.8;
  CONFIG.userProfileEmbeddingThresholdSameCatWeak = 0.5;
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  return new UserProfileManager();
}

const DIMS = 10;

/** Unit vector from a few leading components, padded with zeros. */
function vec(...components: number[]): number[] {
  const v = new Array(DIMS).fill(0);
  components.forEach((c, i) => (v[i] = c));
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  return v.map((x) => x / norm);
}

/** Embedding stub: each description maps to a fixed vector, so similarity is exact. */
function embedFor(vectors: Record<string, number[]>) {
  return {
    isWarmedUp: true,
    embed: async (text: string) => {
      const v = vectors[text.trim()];
      if (!v) throw new Error(`no test vector for "${text}"`);
      return new Float32Array(v);
    },
  } as any;
}

function storedWorkflow(description: string, steps: string[], centroid: number[], frequency = 1) {
  return {
    description,
    steps,
    alpha: 2,
    beta: 1,
    weakAlpha: 1,
    weakBeta: 1,
    confidence: 0.6,
    frequency,
    lastSeen: Date.now(),
    lastMatchTime: Date.now(),
    firstSeen: Date.now(),
    evidence: [] as string[],
    weakHitCount: 0,
    driftBelowCount: 0,
    pendingValidation: false,
    centroid,
    anchor: centroid,
  };
}

const steps = (n: number) => Array.from({ length: n }, (_, i) => `Step number ${i + 1}`);

describe("workflow merging", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omms-wf-merge-"));
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

  it("keeps workflows with a weak similarity as separate entries", async () => {
    const mgr = await makeManager();
    const base = vec(1);
    const vectors: Record<string, number[]> = { "Base workflow for tests": base };
    const incoming = [];
    // Each incoming workflow has cosine 0.65 to the base and about 0.42 to the others.
    for (let i = 1; i <= 8; i++) {
      const description = `Different workflow number ${i}`;
      vectors[description] = vec(0.65, ...new Array(i - 1).fill(0), 0.76);
      incoming.push({ description, steps: steps(4) });
    }
    const existing = {
      preferences: [],
      patterns: [],
      workflows: [storedWorkflow("Base workflow for tests", steps(4), base)],
    };

    const merged = await mgr.mergeProfileData(
      existing as any,
      { workflows: incoming } as any,
      embedFor(vectors)
    );

    const baseWf: any = merged.workflows.find(
      (w: any) => w.description === "Base workflow for tests"
    );
    expect(baseWf.frequency).toBe(1);
    expect(merged.workflows).toHaveLength(9);
  });

  it("merges a workflow that strongly matches one existing workflow", async () => {
    const mgr = await makeManager();
    const base = vec(1);
    const vectors = {
      "Base workflow for tests": base,
      "Nearly the same workflow": vec(0.9, 0.436),
    };
    const existing = {
      preferences: [],
      patterns: [],
      workflows: [storedWorkflow("Base workflow for tests", steps(4), base)],
    };

    const merged = await mgr.mergeProfileData(
      existing as any,
      { workflows: [{ description: "Nearly the same workflow", steps: steps(4) }] } as any,
      embedFor(vectors)
    );

    expect(merged.workflows).toHaveLength(1);
    expect((merged.workflows[0] as any).frequency).toBe(2);
  });

  it("does not fold a second strongly similar workflow into the match", async () => {
    const mgr = await makeManager();
    const x = vec(1);
    const y = vec(0.6, 0.8); // cosine 0.6 to x, so the two start as separate workflows
    const vectors = {
      "Workflow X for tests": x,
      "Workflow Y for tests": y,
      "New workflow close to both": vec(0.9, 0.436), // about 0.90 to x and 0.89 to y
    };
    const existing = {
      preferences: [],
      patterns: [],
      workflows: [
        storedWorkflow("Workflow X for tests", steps(4), x, 3),
        storedWorkflow("Workflow Y for tests", steps(5), y, 3),
      ],
    };

    const merged = await mgr.mergeProfileData(
      existing as any,
      { workflows: [{ description: "New workflow close to both", steps: steps(4) }] } as any,
      embedFor(vectors)
    );

    expect(merged.workflows).toHaveLength(2);
    const byDesc = (d: string): any => merged.workflows.find((w: any) => w.description === d);
    expect(byDesc("Workflow X for tests").frequency).toBe(4);
    expect(byDesc("Workflow Y for tests").frequency).toBe(3);
  });

  it("does not replace the steps of a workflow with a shorter list", async () => {
    const mgr = await makeManager();
    const base = vec(1);
    const vectors = {
      "Base workflow for tests": base,
      "Nearly the same workflow": vec(0.9, 0.436),
    };
    const existing = {
      preferences: [],
      patterns: [],
      workflows: [storedWorkflow("Base workflow for tests", steps(7), base)],
    };

    const merged = await mgr.mergeProfileData(
      existing as any,
      { workflows: [{ description: "Nearly the same workflow", steps: steps(4) }] } as any,
      embedFor(vectors)
    );

    expect((merged.workflows[0] as any).steps).toHaveLength(7);
  });

  it("compares concrete steps, so blank entries do not make a list longer", async () => {
    const mgr = await makeManager();
    const base = vec(1);
    const vectors = {
      "Base workflow for tests": base,
      "Nearly the same workflow": vec(0.9, 0.436),
    };
    const existing = {
      preferences: [],
      patterns: [],
      workflows: [storedWorkflow("Base workflow for tests", steps(4), base)],
    };

    const merged = await mgr.mergeProfileData(
      existing as any,
      {
        workflows: [{ description: "Nearly the same workflow", steps: [...steps(3), "", "  "] }],
      } as any,
      embedFor(vectors)
    );

    expect((merged.workflows[0] as any).steps).toEqual(steps(4));
  });

  it("replaces the steps of a workflow with a longer list", async () => {
    const mgr = await makeManager();
    const base = vec(1);
    const vectors = {
      "Base workflow for tests": base,
      "Nearly the same workflow": vec(0.9, 0.436),
    };
    const existing = {
      preferences: [],
      patterns: [],
      workflows: [storedWorkflow("Base workflow for tests", steps(4), base)],
    };

    const merged = await mgr.mergeProfileData(
      existing as any,
      { workflows: [{ description: "Nearly the same workflow", steps: steps(6) }] } as any,
      embedFor(vectors)
    );

    expect((merged.workflows[0] as any).steps).toHaveLength(6);
  });

  describe("step minimum", () => {
    it("drops an analysed workflow with fewer than 3 steps and keeps the rest of the reply", async () => {
      const mgr = await makeManager();
      const vectors = {
        "Release a package safely": vec(1),
        "Be brief": vec(0, 1),
        "Keep answers short": vec(0, 0, 1),
        "Operates as a methodical engineer": vec(0, 0, 0, 1),
      };

      const merged = await mgr.mergeProfileData(
        { preferences: [], patterns: [], workflows: [] } as any,
        {
          preferences: [
            { category: "style", description: "Be brief", confidence: 0.8, evidence: ["short"] },
          ],
          patterns: [{ category: "style", description: "Keep answers short" }],
          workflows: [
            { description: "Release a package safely", steps: steps(4) },
            { description: "Operates as a methodical engineer", steps: ["Plan", "Build"] },
            { description: "Has no steps at all", steps: [] },
            { description: "Has blank steps", steps: ["Plan", "", "  ", "Build"] },
          ],
        } as any,
        embedFor(vectors)
      );

      expect(merged.workflows.map((w: any) => w.description)).toEqual(["Release a package safely"]);
      expect(merged.preferences).toHaveLength(1);
      expect(merged.patterns).toHaveLength(1);
    });
  });

  describe("first profile", () => {
    it("drops workflows with fewer than 3 steps when the profile is created", async () => {
      const mgr = await makeManager();
      const id = await mgr.createProfile(
        "user-first",
        "First",
        "first",
        "first@example.invalid",
        {
          preferences: [],
          patterns: [],
          workflows: [
            { description: "Release a package safely", steps: steps(4) },
            { description: "Operates as a methodical engineer", steps: ["Plan", "Build"] },
            { description: "Has no steps at all", steps: [] },
          ],
        } as any,
        3
      );

      const stored = await mgr.getProfileById(id);
      const data = JSON.parse(stored!.profileData);
      expect(data.workflows.map((w: any) => w.description)).toEqual(["Release a package safely"]);
    });
  });

  describe("description rewrite", () => {
    const REWRITE = "Operates as a methodical engineer";

    async function matchAtMilestone(itemType: "workflows" | "preferences") {
      const mgr = await makeManager();
      (mgr as any).evolveDescription = async () => REWRITE;
      const base = vec(1);
      const vectors = {
        "Base item for tests": base,
        "Nearly the same item": vec(0.9, 0.436),
      };
      const item: any = storedWorkflow("Base item for tests", steps(4), base, 4);
      item.evidence = ["first sighting", "second sighting", "third sighting", "fourth sighting"];
      if (itemType === "preferences") {
        delete item.steps;
        item.category = "style";
      }
      const existing: any = { preferences: [], patterns: [], workflows: [] };
      existing[itemType] = [item];
      const incomingItem: any =
        itemType === "workflows"
          ? { description: "Nearly the same item", steps: steps(4) }
          : { category: "style", description: "Nearly the same item" };

      const merged = await mgr.mergeProfileData(
        existing,
        { [itemType]: [incomingItem] } as any,
        embedFor(vectors),
        "profile_rewrite"
      );
      return (merged as any)[itemType][0];
    }

    it("is skipped for a workflow at a milestone frequency", async () => {
      const wf = await matchAtMilestone("workflows");
      expect(wf.frequency).toBe(5);
      expect(wf.description).toBe("Base item for tests");
    });

    it("still runs for a preference at a milestone frequency", async () => {
      const pref = await matchAtMilestone("preferences");
      expect(pref.frequency).toBe(5);
      expect(pref.description).toBe(REWRITE);
    });
  });
});
