import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

const root = join(import.meta.dir, "..");

it("ships the omms-memory skill and points Pi at it", () => {
  expect(pkg.files).toContain("skills");
  expect((pkg.pi as { skills?: string[] }).skills).toEqual(["./skills"]);
});

it("packs the skill file and refuses to publish without it", () => {
  const packed = Bun.spawnSync(["npm", "pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    timeout: 25_000,
  });
  if (packed.exitCode !== 0) {
    throw new Error(`npm pack exited with ${packed.exitCode}: ${packed.stderr.toString()}`);
  }
  const [result] = JSON.parse(packed.stdout.toString()) as Array<{ files: { path: string }[] }>;
  expect(result!.files.map((file) => file.path)).toContain("skills/omms-memory/SKILL.md");
  expect(readFileSync(join(root, "scripts/verify-package.mjs"), "utf8")).toContain(
    "skills/omms-memory/SKILL.md"
  );
}, 30_000);
