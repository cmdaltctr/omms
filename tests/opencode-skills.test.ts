import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addPackageSkill,
  applySkillsPathConfig,
  packageSkillsFolder,
} from "../src/adapters/opencode/package-skills.js";

const folder = packageSkillsFolder();

it("finds the package skills folder from the module location", () => {
  expect(folder).toBe(join(import.meta.dir, "..", "skills"));
});

it("adds the skills folder to the OpenCode config once and keeps other paths", () => {
  const cfg: { skills?: { paths?: string[]; urls?: string[] } } = {
    skills: { paths: ["/mine"], urls: ["https://x.invalid"] },
  };
  applySkillsPathConfig(cfg, folder);
  applySkillsPathConfig(cfg, folder);
  expect(cfg.skills).toEqual({ paths: ["/mine", folder], urls: ["https://x.invalid"] });
  const empty: { skills?: { paths?: string[] } } = {};
  applySkillsPathConfig(empty, folder);
  expect(empty.skills).toEqual({ paths: [folder] });
});

it("skips a missing folder and leaves the config unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "omms-no-skills-"));
  try {
    const cfg: { skills?: { paths?: string[] } } = { skills: { paths: ["/mine"] } };
    applySkillsPathConfig(cfg, join(dir, "skills"));
    expect(cfg.skills).toEqual({ paths: ["/mine"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("adds the omms-memory skill to the V2 skill list once", () => {
  const skills: any[] = [];
  const editor = {
    get: (id: string) => skills.find((skill) => skill.id === id),
    add: (skill: any) => skills.push(skill),
  };
  addPackageSkill(editor, folder);
  addPackageSkill(editor, folder);
  expect(skills).toHaveLength(1);
  expect(skills[0]).toMatchObject({
    id: "omms-memory",
    name: "omms-memory",
    path: join(folder, "omms-memory", "SKILL.md"),
  });
  expect(skills[0].description).toContain("debug");
  expect(skills[0].content).toContain("om-memory-system memory search");
});

it("wires both OpenCode hooks to the shared helper", async () => {
  const { readFileSync } = await import("node:fs");
  const v1 = readFileSync(join(import.meta.dir, "../src/index.ts"), "utf8");
  const v2 = readFileSync(join(import.meta.dir, "../src/v2/adapter.ts"), "utf8");
  expect(v1).toContain("applySkillsPathConfig(cfg)");
  expect(v2).toContain("addPackageSkill(");
});
