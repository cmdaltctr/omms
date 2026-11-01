import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { SKILL_DETAIL_SECTIONS } from "../web/src/lib/skill-detail-sections.ts";

const source = readFileSync(
  join(import.meta.dir, "../web/src/lib/components/skills/SkillDetail.tsx"),
  "utf8"
);

describe("the skill view renders its sections in page order", () => {
  it("renders every section of the sections module, in that order", () => {
    const places = SKILL_DETAIL_SECTIONS.map((section) => source.indexOf(`id="${section.id}"`));
    for (const [i, place] of places.entries()) {
      expect(place, `${SKILL_DETAIL_SECTIONS[i].id} is missing`).toBeGreaterThan(-1);
      if (i > 0)
        expect(place, `${SKILL_DETAIL_SECTIONS[i].id} must come after the last`).toBeGreaterThan(
          places[i - 1]
        );
    }
  });

  it("mounts the table of contents and wires its way back to the view's back action", () => {
    expect(source).toContain("<SkillToc onBack={onBack} />");
  });

  it("the table of contents offers All skills above the sections", () => {
    const toc = readFileSync(
      join(import.meta.dir, "../web/src/lib/components/skills/SkillToc.tsx"),
      "utf8"
    );
    expect(toc).toContain('back={{ label: s("All skills"), onBack }}');
    expect(toc).toContain("sections={SKILL_DETAIL_SECTIONS}");
  });

  it("shows Recent turns before Failures", () => {
    expect(source.indexOf("<SkillTurns")).toBeLessThan(source.indexOf("<FailureGroups"));
  });
});
