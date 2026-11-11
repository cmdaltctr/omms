import { expect, it } from "bun:test";
import { join } from "node:path";
import { addPackageSkill, packageSkillsFolder } from "../src/adapters/opencode/package-skills.js";

const folder = packageSkillsFolder();

it("finds the package skills folder from the module location", () => {
  expect(folder).toBe(join(import.meta.dir, "..", "skills"));
});

it("adds the omms-memory and omms-remember skills to the V2 skill list once", () => {
  const skills: any[] = [];
  const editor = {
    get: (id: string) => skills.find((skill) => skill.id === id),
    add: (skill: any) => skills.push(skill),
  };
  addPackageSkill(editor, folder);
  addPackageSkill(editor, folder);
  expect(skills).toHaveLength(2);
  expect(skills[0]).toMatchObject({
    id: "omms-memory",
    name: "omms-memory",
    path: join(folder, "omms-memory", "SKILL.md"),
  });
  expect(skills[0].description).toContain("debug");
  expect(skills[0].content).toContain("om-memory-system memory search");
  expect(skills[1]).toMatchObject({
    id: "omms-remember",
    name: "omms-remember",
    path: join(folder, "omms-remember", "SKILL.md"),
  });
  expect(skills[1].description).toContain("snapshot");
});
