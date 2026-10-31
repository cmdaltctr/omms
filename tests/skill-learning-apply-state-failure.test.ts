import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const OLD = "---\nname: s-web-search\n---\nOld body\n";
const NEW = "---\nname: s-web-search\n---\nNew body\n";
const SECRET = "disk full at /private/secret/path";
const NOW = 5_000;

let baseDir: string;
let skillsDir: string;

async function setup() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const proposals = await import("../src/services/skill-learning/proposal-store.js");
  const apply = await import("../src/services/skill-learning/apply.js");
  const { buildSkillIndex } = await import("../src/services/skill-learning/skill-index.js");
  const { rankSkills } = await import("../src/services/skill-learning/ranking.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  await store.init();
  const deps = { store, folders: [skillsDir], now: () => NOW };
  const modified = async () =>
    (await rankSkills(store, buildSkillIndex([skillsDir]), NOW)).map((r) => r.modified);
  return { store, deps, modified, ...proposals, ...apply };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Makes the next write of a proposal state throw, as a full disk or a locked database would. */
async function failNextStateWrite(store: Setup["store"]) {
  const real = await store.db();
  let armed = true;
  store.db = async () =>
    new Proxy(real, {
      get(target, key) {
        if (key === "run") {
          return async (sql: string, params?: unknown[]) => {
            if (armed && sql.startsWith("UPDATE skill_proposals SET state")) {
              armed = false;
              throw new Error(SECRET);
            }
            return target.run(sql, params as never);
          };
        }
        const value = (target as never)[key];
        return typeof value === "function" ? (value as () => unknown).bind(target) : value;
      },
    });
}

function addSkill(name: string, content = OLD): string {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, content);
  return path;
}

async function improve(s: Setup, path: string) {
  return s.createProposal(
    s.store,
    {
      kind: "improve",
      skillName: "s-web-search",
      skillPath: path,
      baseHash: s.hashSkillContent(OLD),
      content: NEW,
      diff: "-Old body\n+New body",
      summary: "Better body",
      evidenceTurnIds: [1],
    },
    1_000
  );
}

async function brandNew(s: Setup, name: string) {
  return s.createProposal(
    s.store,
    {
      kind: "new",
      skillName: name,
      skillPath: join(skillsDir, name, "SKILL.md"),
      baseHash: null,
      content: `---\nname: ${name}\n---\nBody\n`,
      diff: "",
      summary: "A new skill",
      evidenceTurnIds: [],
    },
    1_000
  );
}

describe("a failed proposal state write after a SKILL.md change", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-state-failure-"));
    skillsDir = join(baseDir, "skills");
    mkdirSync(skillsDir);
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("apply puts the file back, keeps the proposal pending and leaves no version row", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await improve(s, path);
    await failNextStateWrite(s.store);
    const result = await s.applyProposal(proposal.id, "person", s.deps);
    expect(result).toMatchObject({ ok: false, code: "state-write-failed" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(readFileSync(path, "utf8")).toBe(OLD);
    expect((await s.getProposal(s.store, proposal.id))?.state).toBe("pending");
    expect(await s.getLatestVersion(s.store, proposal.id)).toBeNull();
    expect(await s.modified()).toEqual([false]);
    // Nothing is stuck: the same proposal applies once the store works again.
    expect(await s.applyProposal(proposal.id, "person", s.deps)).toMatchObject({ ok: true });
    expect(readFileSync(path, "utf8")).toBe(NEW);
    expect(await s.modified()).toEqual([true]);
  });

  it("apply removes a new skill file and its empty folder", async () => {
    const s = await setup();
    const proposal = await brandNew(s, "fresh-skill");
    await failNextStateWrite(s.store);
    const result = await s.applyProposal(proposal.id, "person", s.deps);
    expect(result).toMatchObject({ ok: false, code: "state-write-failed" });
    expect(existsSync(join(skillsDir, "fresh-skill"))).toBe(false);
    expect((await s.getProposal(s.store, proposal.id))?.state).toBe("pending");
    expect(await s.getLatestVersion(s.store, proposal.id)).toBeNull();
  });

  it("undo writes the applied content back and keeps the proposal applied", async () => {
    const path = addSkill("s-web-search");
    const s = await setup();
    const proposal = await improve(s, path);
    await s.applyProposal(proposal.id, "person", s.deps);
    const version = await s.getLatestVersion(s.store, proposal.id);
    await failNextStateWrite(s.store);
    const result = await s.undoProposal(proposal.id, s.deps);
    expect(result).toMatchObject({ ok: false, code: "state-write-failed" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(readFileSync(path, "utf8")).toBe(NEW);
    expect((await s.getProposal(s.store, proposal.id))?.state).toBe("applied");
    expect((await s.getLatestVersion(s.store, proposal.id))?.id).toBe(version?.id);
    expect(await s.modified()).toEqual([true]);
    // The hash guard still passes, so undo works once the store works again.
    expect(await s.undoProposal(proposal.id, s.deps)).toMatchObject({ ok: true });
    expect(readFileSync(path, "utf8")).toBe(OLD);
    expect(await s.modified()).toEqual([false]);
  });

  it("undo of a new skill writes the file and folder back", async () => {
    const s = await setup();
    const proposal = await brandNew(s, "fresh-skill");
    await s.applyProposal(proposal.id, "person", s.deps);
    const path = join(skillsDir, "fresh-skill", "SKILL.md");
    const written = readFileSync(path, "utf8");
    await failNextStateWrite(s.store);
    const result = await s.undoProposal(proposal.id, s.deps);
    expect(result).toMatchObject({ ok: false, code: "state-write-failed" });
    expect(readFileSync(path, "utf8")).toBe(written);
    expect((await s.getProposal(s.store, proposal.id))?.state).toBe("applied");
    expect(await s.undoProposal(proposal.id, s.deps)).toMatchObject({ ok: true });
    expect(existsSync(path)).toBe(false);
  });
});
