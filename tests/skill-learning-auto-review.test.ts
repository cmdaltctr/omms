import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { allProposals } from "./skill-proposal-helpers.js";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const HOUR = 3_600_000;
const START = 1_000 * HOUR;
const OLD = "---\nname: s-web-search\ndescription: Search the web\n---\nOld body\n";
const NEW = "---\nname: s-web-search\ndescription: Search the web\n---\nNew body\n";
const HAND = "---\nname: s-web-search\ndescription: Search the web\n---\nHand edit\n";

let baseDir: string;
let skillsDir: string;
let skillPath: string;
let clock = START;
let seq = 0;

function turn(at: number) {
  seq += 1;
  return {
    turnKey: `pi:s1:u${seq}`,
    host: "pi",
    sessionId: "s1",
    projectTag: null,
    projectName: null,
    provider: null,
    model: null,
    createdAt: at,
    prompt: "search",
    replies: ["done"],
    redacted: true,
    toolCalls: [],
    skillUses: [{ name: "s-web-search", path: skillPath, method: "tool" as const }],
  };
}

async function setup(onCall: () => void = () => {}) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const { buildSkillIndex } = await import("../src/services/skill-learning/skill-index.js");
  const review = await import("../src/services/skill-learning/auto-review.js");
  const proposals = await import("../src/services/skill-learning/proposal-store.js");
  const { skillDraftBackoff } = await import("../src/core/profile-backoff.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  await store.init();
  const calls: string[] = [];
  const model = {
    ready: true,
    callTool: async (_system: string, user: string) => {
      calls.push(user);
      onCall();
      return { success: true, data: { content: NEW, summary: "Better", evidence: [] } };
    },
  };
  const deps = {
    store,
    index: buildSkillIndex([skillsDir]),
    folders: [skillsDir],
    model,
    lease: review.skillReviewLease(store, () => clock),
  };
  return { store, deps, calls, skillDraftBackoff, ...review, ...proposals };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Automatic mode, reviewed at START with no uses, then `uses` new turns. */
async function prepare(s: Setup, uses: number, mode: "manual" | "automatic" = "automatic") {
  await s.setSkillMode(s.store, skillPath, mode);
  await s.setSkillReview(s.store, skillPath, START, 0);
  for (let i = 0; i < uses; i++) await s.store.insertTurn(turn(START + (i + 1) * 1_000));
}

describe("automatic skill review", () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-auto-review-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(join(skillsDir, "s-web-search"), { recursive: true });
    skillPath = join(skillsDir, "s-web-search", "SKILL.md");
    writeFileSync(skillPath, OLD);
    clock = START + 30 * HOUR;
    (await import("../src/core/profile-backoff.js")).skillDraftBackoff.recordSuccess();
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("does not draft after 9 new uses", async () => {
    const s = await setup();
    await prepare(s, 9);
    const report = await s.runAutoReview(s.deps, clock);
    expect(report.reviews).toEqual([]);
    expect(s.calls).toHaveLength(0);
    expect(readFileSync(skillPath, "utf8")).toBe(OLD);
  });

  it("drafts and applies after 10 new uses and 30 hours", async () => {
    const s = await setup();
    await prepare(s, 10);
    const report = await s.runAutoReview(s.deps, clock);
    expect(report.reviews).toEqual([{ skillPath, code: "applied" }]);
    expect(readFileSync(skillPath, "utf8")).toBe(NEW);
    const [proposal] = await allProposals(s.store);
    expect(proposal).toMatchObject({ state: "applied", appliedBy: "automatic" });
    expect(await s.getSkillSettings(s.store, skillPath)).toMatchObject({
      mode: "automatic",
      lastReviewAt: clock,
      usesAtLastReview: 10,
    });
    // The next run finds no new uses.
    expect((await s.runAutoReview(s.deps, clock + 30 * HOUR)).reviews).toEqual([]);
  });

  it("waits 24 hours after the last review", async () => {
    const s = await setup();
    await prepare(s, 10);
    expect((await s.runAutoReview(s.deps, START + 23 * HOUR)).reviews).toEqual([]);
    expect(s.calls).toHaveLength(0);
  });

  it("starts no draft during the skill draft wait", async () => {
    const s = await setup();
    await prepare(s, 10);
    s.skillDraftBackoff.recordFailure(clock - 60_000);
    const report = await s.runAutoReview(s.deps, clock);
    expect(report).toMatchObject({ skipped: "backoff", reviews: [] });
    expect(s.calls).toHaveLength(0);
    expect(readFileSync(skillPath, "utf8")).toBe(OLD);
  });

  it("marks the proposal stale and keeps a hand edit made after the draft", async () => {
    const s = await setup(() => writeFileSync(skillPath, HAND));
    await prepare(s, 10);
    const report = await s.runAutoReview(s.deps, clock);
    expect(report.reviews).toEqual([{ skillPath, code: "stale" }]);
    expect(readFileSync(skillPath, "utf8")).toBe(HAND);
    const [proposal] = await allProposals(s.store);
    expect(proposal?.state).toBe("stale");
  });

  it("never drafts for a skill in manual mode", async () => {
    const s = await setup();
    await prepare(s, 12, "manual");
    expect((await s.runAutoReview(s.deps, clock)).reviews).toEqual([]);
    expect(s.calls).toHaveLength(0);
  });

  it("skips while another process holds the review lease", async () => {
    const s = await setup();
    await prepare(s, 10);
    await s.deps.lease.take("other-process");
    const report = await s.runAutoReview(s.deps, clock);
    expect(report).toMatchObject({ skipped: "busy", reviews: [] });
    expect(s.calls).toHaveLength(0);
  });

  it("runs the review on its interval until stopped", async () => {
    const s = await setup();
    let ticks = 0;
    const stop = s.startAutoReviewLoop(async () => {
      ticks += 1;
      return null;
    }, 5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    const seen = ticks;
    expect(seen).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ticks).toBe(seen);
  });
});
