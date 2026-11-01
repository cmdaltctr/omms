import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const view = readFileSync(
  join(import.meta.dir, "../web/src/lib/components/skills/SkillsView.tsx"),
  "utf8"
);
// Read, not import: the module's own $lib import only resolves inside the app.
const sectionsSource = readFileSync(
  join(import.meta.dir, "../web/src/lib/skills-sections.ts"),
  "utf8"
);
const ids = [...sectionsSource.matchAll(/id: "(skills-section-[a-z-]+)"/g)].map((m) => m[1]);

describe("the Skills page table of contents", () => {
  it("mounts the shared floating contents on the list view only", () => {
    expect(view).toContain(
      '<PageToc storageKey="omms-skills-toc-open" sections={SKILLS_SECTIONS} />'
    );
    expect(view).toContain("<SkillDetail");
  });

  it("lists every Skills page section, each with its skills-section id", () => {
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("skills-section-ranked");
    expect(ids).toContain("skills-section-folders");
  });
});
