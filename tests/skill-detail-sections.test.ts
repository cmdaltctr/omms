import { describe, expect, it } from "bun:test";
import { skillText } from "../web/src/lib/i18n/skills.ts";
import { SKILL_DETAIL_SECTIONS } from "../web/src/lib/skill-detail-sections.ts";

describe("SKILL_DETAIL_SECTIONS", () => {
  it("lists the skill-view sections in page order, Failures after Recent turns", () => {
    expect(SKILL_DETAIL_SECTIONS.map((section) => section.title)).toEqual([
      "Mode",
      "Proposals",
      "History",
      "Recent turns",
      "Failures",
    ]);
  });

  it("gives every section a unique skill-section id", () => {
    const ids = SKILL_DETAIL_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^skill-section-[a-z-]+$/);
    }
  });

  it("titles every section with a translated message", () => {
    for (const section of SKILL_DETAIL_SECTIONS) {
      expect(skillText).toHaveProperty(section.title);
    }
  });
});
