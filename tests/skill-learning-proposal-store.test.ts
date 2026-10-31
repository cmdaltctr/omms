import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

let baseDir: string;

async function setup(init = true) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const proposals = await import("../src/services/skill-learning/proposal-store.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  if (init) await store.init();
  return { store, ...proposals };
}

function input(skillName: string, kind: "improve" | "new" = "improve") {
  return {
    kind,
    skillName,
    skillPath: `/skills/${skillName}/SKILL.md`,
    baseHash: kind === "improve" ? "hash" : null,
    content: "content",
    diff: "diff",
    summary: "summary",
    evidenceTurnIds: [3, 7],
  };
}

describe("skill proposal store", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-proposals-"));
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("creates a pending proposal and reads it back", async () => {
    const s = await setup();
    const created = await s.createProposal(s.store, input("a"), 1_000);
    expect(created).toMatchObject({
      kind: "improve",
      skillName: "a",
      skillPath: "/skills/a/SKILL.md",
      baseHash: "hash",
      state: "pending",
      appliedBy: null,
      evidenceTurnIds: [3, 7],
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(await s.getProposal(s.store, created.id)).toEqual(created);
    expect(await s.getProposal(s.store, "missing")).toBeNull();
  });

  it("lists proposals newest first and filters by state and skill", async () => {
    const s = await setup();
    const a = await s.createProposal(s.store, input("a"), 1_000);
    const b = await s.createProposal(s.store, input("b", "new"), 2_000);
    expect(await s.updateProposalState(s.store, a.id, "applied", 3_000, "agent")).toBe(true);
    expect((await s.listProposals(s.store)).map((p) => p.id)).toEqual([b.id, a.id]);
    expect((await s.listProposals(s.store, { state: "pending" })).map((p) => p.id)).toEqual([b.id]);
    expect((await s.listProposals(s.store, { skillName: "a" }))[0]).toMatchObject({
      state: "applied",
      appliedBy: "agent",
      updatedAt: 3_000,
    });
    expect(await s.updateProposalState(s.store, "missing", "rejected", 4_000)).toBe(false);
  });

  it("returns the latest saved version for a proposal", async () => {
    const s = await setup();
    const p = await s.createProposal(s.store, input("a"), 1_000);
    await s.saveSkillVersion(
      s.store,
      { proposalId: p.id, path: "/x", previousContent: "one", writtenHash: "h1" },
      1
    );
    await s.saveSkillVersion(
      s.store,
      { proposalId: p.id, path: "/x", previousContent: null, writtenHash: "h2" },
      2
    );
    expect(await s.getLatestVersion(s.store, p.id)).toMatchObject({
      proposalId: p.id,
      path: "/x",
      previousContent: null,
      writtenHash: "h2",
      savedAt: 2,
    });
    expect(await s.getLatestVersion(s.store, "missing")).toBeNull();
  });

  it("defaults a skill to manual and keeps its mode and review separately", async () => {
    const s = await setup();
    expect(await s.getSkillSettings(s.store, "/p")).toEqual({
      skillPath: "/p",
      mode: "manual",
      lastReviewAt: null,
      usesAtLastReview: 0,
    });
    await s.setSkillMode(s.store, "/p", "automatic");
    await s.setSkillReview(s.store, "/p", 9_000, 14);
    await s.setSkillMode(s.store, "/p", "automatic");
    expect(await s.getSkillSettings(s.store, "/p")).toEqual({
      skillPath: "/p",
      mode: "automatic",
      lastReviewAt: 9_000,
      usesAtLastReview: 14,
    });
  });

  it("reads from a missing file without creating it", async () => {
    const s = await setup(false);
    expect(await s.listProposals(s.store)).toEqual([]);
    expect(await s.getProposal(s.store, "x")).toBeNull();
    expect((await s.getSkillSettings(s.store, "/p")).mode).toBe("manual");
    expect(existsSync(join(baseDir, "skills.db"))).toBe(false);
  });
});
