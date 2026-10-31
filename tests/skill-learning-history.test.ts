import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const V0 = "---\nname: alpha\n---\nBody 0\n";
const V1 = "---\nname: alpha\n---\nBody 1\nExtra\n";
const V2 = "---\nname: alpha\n---\nBody 2\n";

let baseDir: string;
let skillsDir: string;
let clock = 10_000;

async function setup() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const proposals = await import("../src/services/skill-learning/proposal-store.js");
  const apply = await import("../src/services/skill-learning/apply.js");
  const history = await import("../src/services/skill-learning/history.js");
  const { lineDiff } = await import("../src/services/skill-learning/line-diff.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  await store.init();
  const deps = { store, folders: [skillsDir], now: () => (clock += 100) };
  return { store, deps, lineDiff, ...proposals, ...apply, ...history };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function skillPath(name = "alpha"): string {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  return join(dir, "SKILL.md");
}

async function draft(s: Setup, path: string, base: string, content: string, name = "alpha") {
  return s.createProposal(
    s.store,
    {
      kind: "improve",
      skillName: name,
      skillPath: path,
      baseHash: s.hashSkillContent(base),
      content,
      diff: s.lineDiff(base, content),
      summary: `Change to ${content.length}`,
      evidenceTurnIds: [],
    },
    (clock += 100)
  );
}

describe("skill history", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-history-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
    clock = 10_000;
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("returns nothing for an unknown skill and for a missing skills.db", async () => {
    const s = await setup();
    expect(await s.skillHistory(s.deps, { path: "/no/SKILL.md" }, 20, 0)).toEqual({
      total: 0,
      entries: [],
    });
    const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
    const missing = new SkillStore(skillsDbPath(join(baseDir, "nowhere")));
    expect(await s.skillHistory({ ...s.deps, store: missing }, { name: "alpha" }, 20, 0)).toEqual({
      total: 0,
      entries: [],
    });
  });

  it("lists created, applied, rejected, undone and stale entries newest first", async () => {
    const path = skillPath();
    writeFileSync(path, V0);
    const s = await setup();
    const p1 = await draft(s, path, V0, V1); // applied
    const p2 = await draft(s, path, V0, V2); // rejected
    await s.updateProposalState(s.store, p2.id, "rejected", (clock += 100));
    const p3 = await draft(s, path, V0, V2); // pending
    await s.applyProposal(p1.id, "person", s.deps);

    const { total, entries } = await s.skillHistory(s.deps, { path }, 50, 0);
    // p1: created + applied. p2: created + rejected. p3: created.
    expect(total).toBe(5);
    const ats = entries.map((e) => e.at);
    expect([...ats].sort((a, b) => b - a)).toEqual(ats);
    expect(
      entries.map(
        (e) => `${e.proposalId === p1.id ? "p1" : e.proposalId === p2.id ? "p2" : "p3"}:${e.kind}`
      )
    ).toEqual(["p1:applied", "p3:created", "p2:rejected", "p2:created", "p1:created"]);
    const applied = entries[0]!;
    expect(applied).toMatchObject({
      kind: "applied",
      appliedBy: "person",
      canUndo: true,
      laterAppliedCount: 0,
      summary: p1.summary,
    });
    expect(applied.versionId).not.toBeNull();
    expect(applied.added).toBe(2);
    expect(applied.removed).toBe(1);
    expect(entries[1]).toMatchObject({ kind: "created", appliedBy: null, versionId: null });
    expect(entries[1]!.canUndo).toBe(false);
    expect(new Set(entries.map((e) => e.id)).size).toBe(5);

    // Stale: the file changed after the draft, so apply marks it stale.
    writeFileSync(path, "edited by hand\n");
    await s.applyProposal(p3.id, "person", s.deps);
    const after = await s.skillHistory(s.deps, { path }, 50, 0);
    expect(after.entries[0]).toMatchObject({ kind: "stale", proposalId: p3.id, canUndo: false });
  });

  it("pages with limit and offset and reports the full total", async () => {
    const path = skillPath();
    writeFileSync(path, V0);
    const s = await setup();
    for (let i = 0; i < 4; i++) await draft(s, path, V0, V1);
    const all = await s.skillHistory(s.deps, { path }, 200, 0);
    const page = await s.skillHistory(s.deps, { path }, 3, 2);
    expect(all.total).toBe(4);
    expect(page.total).toBe(4);
    expect(page.entries.map((e) => e.id)).toEqual(all.entries.slice(2, 4).map((e) => e.id));
  });

  it("selects by name when no path is given", async () => {
    const path = skillPath();
    writeFileSync(path, V0);
    const other = skillPath("beta");
    writeFileSync(other, V0);
    const s = await setup();
    await draft(s, path, V0, V1);
    await draft(s, other, V0, V1, "beta");
    expect((await s.skillHistory(s.deps, { name: "alpha" }, 20, 0)).total).toBe(1);
    expect((await s.skillHistory(s.deps, { path: other }, 20, 0)).total).toBe(1);
  });

  it("allows undo only for the change that still matches the file, and counts later changes", async () => {
    const path = skillPath();
    writeFileSync(path, V0);
    const s = await setup();
    const older = await draft(s, path, V0, V1);
    await s.applyProposal(older.id, "person", s.deps);
    const newer = await draft(s, path, V1, V2);
    await s.applyProposal(newer.id, "agent", s.deps);

    const { entries } = await s.skillHistory(s.deps, { path }, 50, 0);
    const appliedOlder = entries.find((e) => e.proposalId === older.id && e.kind === "applied")!;
    const appliedNewer = entries.find((e) => e.proposalId === newer.id && e.kind === "applied")!;
    expect(appliedNewer).toMatchObject({ canUndo: true, laterAppliedCount: 0, appliedBy: "agent" });
    // Undo would refuse the older change: the file holds the newer content.
    expect(appliedOlder).toMatchObject({ canUndo: false, laterAppliedCount: 1 });
    const refused = await s.undoProposal(older.id, s.deps);
    expect(refused).toMatchObject({ ok: false, code: "changed" });

    // Undo the newer change: the older one can be undone again, and nothing is later.
    expect((await s.undoProposal(newer.id, s.deps)).ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(V1);
    const next = await s.skillHistory(s.deps, { path }, 50, 0);
    expect(next.entries[0]).toMatchObject({ kind: "undone", proposalId: newer.id, canUndo: false });
    const olderNow = next.entries.find((e) => e.proposalId === older.id && e.kind === "applied")!;
    expect(olderNow).toMatchObject({ canUndo: true, laterAppliedCount: 0 });
  });

  it("sets canUndo false when the file was changed by hand", async () => {
    const path = skillPath();
    writeFileSync(path, V0);
    const s = await setup();
    const p = await draft(s, path, V0, V1);
    await s.applyProposal(p.id, "person", s.deps);
    writeFileSync(path, "hand edit\n");
    const { entries } = await s.skillHistory(s.deps, { path }, 20, 0);
    expect(entries[0]).toMatchObject({ kind: "applied", canUndo: false });
  });
});

describe("diff line counts", () => {
  it("counts added and removed lines and skips hunk headers", async () => {
    const { countDiffLines } = await import("../src/services/skill-learning/history.js");
    expect(countDiffLines("@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d")).toEqual({ added: 2, removed: 1 });
    expect(countDiffLines("@@ -1,1 +1,1 @@\n-----\n++++")).toEqual({ added: 1, removed: 1 });
    expect(countDiffLines(null)).toEqual({ added: 0, removed: 0 });
    expect(countDiffLines("")).toEqual({ added: 0, removed: 0 });
  });
});
