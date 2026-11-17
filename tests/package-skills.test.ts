import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import pkg from "../package.json";
import { addPackageSkill } from "../src/adapters/opencode/package-skills.js";

const root = join(import.meta.dir, "..");

it("ships both skills and points Pi at their shared folder", () => {
  expect(pkg.files).toContain("skills");
  expect((pkg.pi as { skills?: string[] }).skills).toEqual(["./skills"]);
});

it("packs both skill files and refuses to publish without them", () => {
  // The test runner puts a refusing npm first on PATH. This dry run writes nothing,
  // so it opts in to the real npm that the runner names. See TDR-087.
  const realNpm = process.env.OMMS_TEST_REAL_NPM;
  const packed = Bun.spawnSync(["npm", "pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    env: realNpm
      ? { ...process.env, PATH: `${dirname(realNpm)}${delimiter}${process.env.PATH}` }
      : process.env,
    timeout: 25_000,
  });
  if (packed.exitCode !== 0) {
    throw new Error(`npm pack exited with ${packed.exitCode}: ${packed.stderr.toString()}`);
  }
  const [result] = JSON.parse(packed.stdout.toString()) as Array<{ files: { path: string }[] }>;
  const files = result!.files.map((file) => file.path);
  expect(files).toContain("skills/omms-memory/SKILL.md");
  expect(files).toContain("skills/omms-remember/SKILL.md");
  const verifyPackage = readFileSync(join(root, "scripts/verify-package.mjs"), "utf8");
  expect(verifyPackage).toContain("skills/omms-memory/SKILL.md");
  expect(verifyPackage).toContain("skills/omms-remember/SKILL.md");
}, 30_000);

it("registers both skills with OpenCode", () => {
  const skills = new Map<string, { path: string }>();
  addPackageSkill(
    {
      get: (id) => skills.get(id),
      add: (skill) => skills.set(skill.id, skill),
    },
    join(root, "skills")
  );

  expect([...skills.keys()].sort()).toEqual(["omms-memory", "omms-remember"]);
  expect(skills.get("omms-remember")?.path).toBe(join(root, "skills/omms-remember/SKILL.md"));
});
