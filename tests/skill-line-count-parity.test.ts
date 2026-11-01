import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diffStat } from "../web/src/lib/skills-model.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

/**
 * The Skills page counts the lines of a proposal it holds in full (`diffStat`), for a
 * card after Apply. The server counts them for a list (`proposalLineCounts`). A card
 * must not change its line chip when it swaps one count for the other.
 */

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "skill-line-parity-"));
});

afterEach(async () => {
  await cleanupTursoTestDirectory(baseDir);
});

async function setup() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
  const { createProposal } = await import("../src/services/skill-learning/proposal-store.js");
  const { proposalLineCounts } =
    await import("../src/services/skill-learning/proposal-summaries.js");
  const { lineDiff } = await import("../src/services/skill-learning/line-diff.js");
  const store = new SkillStore(skillsDbPath(baseDir));
  await store.init();
  return { store, createProposal, proposalLineCounts, lineDiff };
}

const EDITS: [string, string, string][] = [
  ["lines added and removed", "a\nb\nc\n", "a\nB\nc\nd\ne\n"],
  ["only additions", "a\n", "a\nb\nc\n"],
  ["only removals", "a\nb\nc\n", "a\n"],
  ["a markdown rule removed", "intro\n---\nbody\n", "intro\nbody\n"],
  ["a markdown rule added", "intro\nbody\n", "intro\n---\n+++\nbody\n"],
  [
    "two separate hunks",
    `${"x\n".repeat(12)}old\n${"y\n".repeat(12)}`,
    `${"x\n".repeat(12)}new\n${"y\n".repeat(12)}z\n`,
  ],
];

const NEW_SKILLS: [string, string][] = [
  ["three lines", "one\ntwo\nthree"],
  ["a trailing newline", "one\ntwo\n"],
  ["a blank body", "  \n\n"],
  ["an empty body", ""],
  ["a single line", "only"],
];

describe("line counts: the page and the server agree", () => {
  for (const [name, before, after] of EDITS) {
    it(`for a diff with ${name}`, async () => {
      const s = await setup();
      const diff = s.lineDiff(before, after);
      const p = await s.createProposal(
        s.store,
        {
          kind: "improve",
          skillName: "alpha",
          skillPath: "/skills/alpha/SKILL.md",
          baseHash: "h",
          content: after,
          diff,
          summary: null,
          evidenceTurnIds: [],
        },
        1_000
      );
      const server = (await s.proposalLineCounts(s.store, [p.id])).get(p.id)!;
      const page = diffStat({ diff, content: after });
      expect({ added: server.added, removed: server.removed }).toEqual(page);
      expect(server.hasDiff).toBe(true);
    });
  }

  const HAND_WRITTEN: [string, string][] = [
    ["a plus sign on the first line", "+first\n+second\n kept"],
    ["a minus sign on the first line", "-first\n kept\n-third"],
    ["runs of signs", "@@ -1,1 +1,1 @@\n-----\n++++\n+-+-"],
    ["an empty diff", ""],
    ["a single header", "@@ -0,0 +1,1 @@"],
    ["multibyte text", "@@ -1,2 +1,2 @@\n-café ☕\n+café 🍵\n 日本語\n+語"],
    ["Windows line endings", "@@ -1,2 +1,2 @@\r\n-old\r\n+new\r\n kept"],
    ["blank lines between changes", "+a\n\n+b\n\n-c\n"],
  ];

  for (const [name, diff] of HAND_WRITTEN) {
    it(`for a hand-written diff with ${name}`, async () => {
      const s = await setup();
      const p = await s.createProposal(
        s.store,
        {
          kind: "improve",
          skillName: "alpha",
          skillPath: "/skills/alpha/SKILL.md",
          baseHash: "h",
          content: "unused",
          diff,
          summary: null,
          evidenceTurnIds: [],
        },
        1_000
      );
      const { countDiffLines } = await import("../src/services/skill-learning/line-diff.js");
      const server = (await s.proposalLineCounts(s.store, [p.id])).get(p.id)!;
      expect({ added: server.added, removed: server.removed }).toEqual(countDiffLines(diff));
      expect({ added: server.added, removed: server.removed }).toEqual(
        diffStat({ diff, content: "" })
      );
      expect(server.hasDiff).toBe(true);
    });
  }

  for (const [name, content] of NEW_SKILLS) {
    it(`for a new skill with ${name}`, async () => {
      const s = await setup();
      const p = await s.createProposal(
        s.store,
        {
          kind: "new",
          skillName: "fresh",
          skillPath: "/skills/fresh/SKILL.md",
          baseHash: null,
          content,
          diff: null,
          summary: null,
          evidenceTurnIds: [],
        },
        1_000
      );
      const server = (await s.proposalLineCounts(s.store, [p.id])).get(p.id)!;
      const page = diffStat({ diff: null, content });
      expect({ added: server.added, removed: server.removed }).toEqual(page);
      expect(server.hasDiff).toBe(false);
    });
  }
});
