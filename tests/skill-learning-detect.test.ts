import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  buildSkillIndex,
  clearSkillIndexCache,
  getSkillIndex,
} from "../src/services/skill-learning/skill-index.js";
import { detectSkillUses } from "../src/services/skill-learning/skill-detect.js";

let root: string;

function skill(rel: string, frontMatter?: string): string {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  writeFileSync(
    file,
    frontMatter === undefined ? "# Body only\n" : `---\n${frontMatter}\n---\n# Body\n`
  );
  return file;
}

describe("skill index", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "skill-index-"));
    clearSkillIndexCache();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds a skill in a nested category folder", () => {
    const path = skill(
      "web/search/s-web-search",
      "name: s-web-search\ndescription: Search the web"
    );
    const index = buildSkillIndex([root]);
    expect(index.entries).toEqual([
      { name: "s-web-search", path, folder: root, description: "Search the web" },
    ]);
  });

  it("finds skills up to four levels deep and no deeper", () => {
    skill("a/b/c/four");
    skill("a/b/c/d/five");
    const names = buildSkillIndex([root]).entries.map((e) => e.name);
    expect(names).toEqual(["four"]);
  });

  it("uses the front matter name, and the folder name when front matter has none", () => {
    skill("folder-one", 'name: "named-skill"\ndescription: x');
    skill("folder-two", "description: no name here");
    skill("folder-three");
    const names = buildSkillIndex([root])
      .entries.map((e) => e.name)
      .sort();
    expect(names).toEqual(["folder-three", "folder-two", "named-skill"]);
  });

  it("keeps duplicate names with their paths", () => {
    const a = skill("one/dup", "name: dup");
    const b = skill("two/dup", "name: dup");
    const paths = buildSkillIndex([root])
      .entries.filter((e) => e.name === "dup")
      .map((e) => e.path)
      .sort();
    expect(paths).toEqual([a, b].sort());
  });

  it("caches the index for 60 seconds per folder list, and clears on request", () => {
    skill("first");
    const t0 = 1_000_000;
    expect(getSkillIndex([root], t0).entries).toHaveLength(1);
    skill("second");
    expect(getSkillIndex([root], t0 + 59_000).entries).toHaveLength(1);
    expect(getSkillIndex([root], t0 + 61_000).entries).toHaveLength(2);
    skill("third");
    clearSkillIndexCache();
    expect(getSkillIndex([root], t0 + 62_000).entries).toHaveLength(3);
  });

  it("skips a folder that does not exist", () => {
    expect(buildSkillIndex([join(root, "missing")]).entries).toEqual([]);
  });

  it("lists a skill once when a linked folder is also watched", () => {
    const path = skill("real/s-web-search", "name: s-web-search");
    const real = join(root, "real");
    const link = join(root, "link");
    symlinkSync(real, link, "dir");
    const index = buildSkillIndex([real, link]);
    expect(index.entries.map((e) => e.path)).toEqual([path]);
  });
});

describe("skill use detection with a linked folder", () => {
  let real: string;
  let link: string;
  let path: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "skill-link-"));
    real = join(root, "agents-skills");
    link = join(root, "claude-skills");
    path = skill("agents-skills/s-web-search", "name: s-web-search");
    symlinkSync(real, link, "dir");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("gives a tool use the path when both spellings are watched", () => {
    const uses = detectSkillUses(
      { prompt: "go", toolCalls: [{ name: "Skill", input: 'skill: "s-web-search"' }] },
      buildSkillIndex([real, link])
    );
    expect(uses).toEqual([{ name: "s-web-search", path, method: "tool", position: 0 }]);
  });

  it("matches a read through the linked spelling to the indexed path", () => {
    const linked = join(link, "s-web-search", "SKILL.md");
    const uses = detectSkillUses(
      // Hosts write each value with JSON.stringify, which escapes Windows backslashes.
      {
        prompt: "go",
        toolCalls: [{ name: "Read", input: `file_path: ${JSON.stringify(linked)}` }],
      },
      buildSkillIndex([real])
    );
    expect(uses).toEqual([{ name: "s-web-search", path, method: "read", position: 0 }]);
  });
});

describe("skill use detection", () => {
  const folder = "/home/u/.agents/skills";
  const index = {
    folders: [folder],
    entries: [
      {
        name: "s-web-search",
        path: `${folder}/web/search/s-web-search/SKILL.md`,
        folder,
        description: "",
      },
      { name: "dup", path: `${folder}/one/dup/SKILL.md`, folder, description: "" },
      { name: "dup", path: `${folder}/two/dup/SKILL.md`, folder, description: "" },
    ],
  };

  it("detects a Claude Code Skill tool call", () => {
    const uses = detectSkillUses(
      { prompt: "go", toolCalls: [{ name: "Skill", input: 'skill: "s-web-search"' }] },
      index
    );
    expect(uses).toEqual([
      { name: "s-web-search", path: index.entries[0]!.path, method: "tool", position: 0 },
    ]);
  });

  it("matches a plugin:skill name on the part after the colon", () => {
    const uses = detectSkillUses(
      {
        prompt: "go",
        toolCalls: [{ name: "Skill", input: 'skill: "tools:s-web-search", args: "x"' }],
      },
      index
    );
    expect(uses[0]).toEqual({
      name: "s-web-search",
      path: index.entries[0]!.path,
      method: "tool",
      position: 0,
    });
  });

  it("keeps the full namespaced name when the part after the colon is not watched", () => {
    const uses = detectSkillUses(
      {
        prompt: "/opsx:apply skill-learning",
        toolCalls: [{ name: "Skill", input: 'skill: "opsx:apply"' }],
      },
      index
    );
    expect(uses).toEqual([{ name: "opsx:apply", path: null, method: "tool", position: 0 }]);
  });

  it("detects an OpenCode skill tool call, in the live and the import input format", () => {
    const live = detectSkillUses(
      { prompt: "go", toolCalls: [{ name: "skill", input: 'name: "s-web-search"' }] },
      index
    );
    const imported = detectSkillUses(
      { prompt: "go", toolCalls: [{ name: "skill", input: '{"name":"s-web-search"}' }] },
      index
    );
    expect(live.map((u) => [u.name, u.method])).toEqual([["s-web-search", "tool"]]);
    expect(imported.map((u) => [u.name, u.method])).toEqual([["s-web-search", "tool"]]);
  });

  it("records a tool use of a skill outside the index with no path", () => {
    const uses = detectSkillUses(
      { prompt: "go", toolCalls: [{ name: "Skill", input: 'skill: "elsewhere"' }] },
      index
    );
    expect(uses).toEqual([{ name: "elsewhere", path: null, method: "tool", position: 0 }]);
  });

  it("gives no path when the name has two skills", () => {
    const uses = detectSkillUses(
      { prompt: "go", toolCalls: [{ name: "Skill", input: 'skill: "dup"' }] },
      index
    );
    expect(uses).toEqual([{ name: "dup", path: null, method: "tool", position: 0 }]);
  });

  it("detects a read of a SKILL.md inside a watched folder", () => {
    const path = index.entries[0]!.path;
    const uses = detectSkillUses(
      {
        prompt: "go",
        toolCalls: [
          { name: "read", input: `path: "${path}"` },
          { name: "Read", input: `file_path: "/elsewhere/x/SKILL.md"` },
          { name: "read", input: `{"filePath":"${folder}/two/dup/SKILL.md"}` },
        ],
      },
      index
    );
    expect(uses).toEqual([
      { name: "s-web-search", path, method: "read", position: 0 },
      { name: "dup", path: `${folder}/two/dup/SKILL.md`, method: "read", position: 2 },
    ]);
  });

  it("detects a long SKILL.md read from the full path when the input is cut", () => {
    const path = `${folder}/${"deep/".repeat(30)}long-skill/SKILL.md`;
    const input = `file_path: ${JSON.stringify(path)}`.substring(0, 100) + "...";
    const uses = detectSkillUses(
      { prompt: "go", toolCalls: [{ name: "Read", input, path }] },
      index
    );
    // The code resolves a read path, so Windows adds the drive letter.
    expect(uses).toEqual([
      { name: "long-skill", path: resolve(path), method: "read", position: 0 },
    ]);
    // Without `path`, the cut input alone does not show the SKILL.md.
    expect(detectSkillUses({ prompt: "go", toolCalls: [{ name: "Read", input }] }, index)).toEqual(
      []
    );
  });

  it("names a read SKILL.md by its folder when the index does not list it", () => {
    const uses = detectSkillUses(
      {
        prompt: "go",
        toolCalls: [{ name: "read", input: `path: "${folder}/new/fresh/SKILL.md"` }],
      },
      index
    );
    expect(uses).toEqual([
      {
        name: "fresh",
        path: resolve(`${folder}/new/fresh/SKILL.md`),
        method: "read",
        position: 0,
      },
    ]);
  });

  it("detects commands in the slash, Pi and Claude Code forms", () => {
    const path = index.entries[0]!.path;
    for (const prompt of [
      "/s-web-search find bun docs",
      "/skill:s-web-search find bun docs",
      "<command-message>x</command-message>\n<command-name>/s-web-search</command-name>",
    ]) {
      expect(detectSkillUses({ prompt, toolCalls: [] }, index)).toEqual([
        { name: "s-web-search", path, method: "command", position: -1 },
      ]);
    }
  });

  it("ignores an unknown command and a slash later in the prompt", () => {
    expect(detectSkillUses({ prompt: "/compact", toolCalls: [] }, index)).toEqual([]);
    expect(detectSkillUses({ prompt: "use /s-web-search", toolCalls: [] }, index)).toEqual([]);
  });

  it("records one use per skill and method", () => {
    const uses = detectSkillUses(
      {
        prompt: "/s-web-search",
        toolCalls: [
          { name: "Skill", input: 'skill: "s-web-search"' },
          { name: "Skill", input: 'skill: "s-web-search"' },
        ],
      },
      index
    );
    expect(uses.map((u) => u.method).sort()).toEqual(["command", "tool"]);
  });

  it("gives the index of the tool call that loaded the skill, and -1 for a command", () => {
    const uses = detectSkillUses(
      {
        prompt: "/s-web-search",
        toolCalls: [
          { name: "Bash", input: 'command: "ls"' },
          { name: "Bash", input: 'command: "pwd"' },
          { name: "Skill", input: 'skill: "dup"' },
          { name: "Skill", input: 'skill: "s-web-search"' },
          { name: "Skill", input: 'skill: "dup"' },
        ],
      },
      index
    );
    const position = (name: string, method: string) =>
      uses.find((u) => u.name === name && u.method === method)?.position;
    expect(position("s-web-search", "command")).toBe(-1);
    expect(position("s-web-search", "tool")).toBe(3);
    // A repeat load keeps the first index.
    expect(position("dup", "tool")).toBe(2);
  });
});
