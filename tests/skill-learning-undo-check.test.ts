import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The undo checks that need no database. `canUndo` in a list and `undoProposal`
 * both run them, so they cannot disagree about the file.
 */

const WRITTEN = "---\nname: alpha\n---\nBody written by OMMS\n";

let root: string;
let skillsDir: string;
let skillFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skill-undo-check-"));
  skillsDir = join(root, "skills");
  mkdirSync(join(skillsDir, "alpha"), { recursive: true });
  skillFile = join(skillsDir, "alpha", "SKILL.md");
  writeFileSync(skillFile, WRITTEN);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function facts(over: Record<string, unknown> = {}) {
  const { hashSkillContent } = await import("../src/services/skill-learning/apply.js");
  return {
    id: "p-1",
    readOnly: false,
    state: "applied",
    version: { path: skillFile, writtenHash: hashSkillContent(WRITTEN) },
    folders: [skillsDir],
    ...over,
  };
}

describe("checkUndo", () => {
  it("accepts an applied proposal whose file still holds what OMMS wrote", async () => {
    const { checkUndo } = await import("../src/services/skill-learning/apply.js");
    const check = checkUndo(await facts());
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.real.endsWith(join("alpha", "SKILL.md"))).toBe(true);
  });

  it("says changed when the file was edited or is gone", async () => {
    const { checkUndo } = await import("../src/services/skill-learning/apply.js");
    writeFileSync(skillFile, WRITTEN + "A hand edit\n");
    expect(checkUndo(await facts())).toMatchObject({ ok: false, code: "changed" });
    rmSync(skillFile);
    expect(checkUndo(await facts())).toMatchObject({ ok: false, code: "changed" });
  });

  it("refuses a path outside the watched folders and a name other than SKILL.md", async () => {
    const { checkUndo } = await import("../src/services/skill-learning/apply.js");
    const outside = join(root, "elsewhere", "SKILL.md");
    expect(checkUndo(await facts({ version: { path: outside, writtenHash: "x" } }))).toMatchObject({
      ok: false,
      code: "outside-folder",
    });
    const other = join(skillsDir, "alpha", "notes.md");
    expect(checkUndo(await facts({ version: { path: other, writtenHash: "x" } }))).toMatchObject({
      ok: false,
      code: "outside-folder",
    });
  });

  it("refuses a proposal that is not applied or has no saved version", async () => {
    const { checkUndo } = await import("../src/services/skill-learning/apply.js");
    expect(checkUndo(await facts({ state: "pending" }))).toMatchObject({
      ok: false,
      code: "not-applied",
      message: "Proposal p-1 is pending",
    });
    expect(checkUndo(await facts({ version: null }))).toMatchObject({
      ok: false,
      code: "no-version",
      message: "No saved version for p-1",
    });
  });

  it("checks read-only first", async () => {
    const { checkUndo } = await import("../src/services/skill-learning/apply.js");
    expect(checkUndo(await facts({ readOnly: true, state: "pending" }))).toMatchObject({
      ok: false,
      code: "read-only",
    });
  });
});
