import { describe, expect, it } from "bun:test";
import {
  canonicaliseCategories,
  categoryKey,
  tidyCategory,
} from "../src/services/user-profile/profile-category.js";

function profile(preferences: string[], patterns: string[] = []) {
  const item = (category: string, index: number) => ({
    category,
    description: `Observation ${index}`,
    frequency: index + 1,
    evidence: ["Evidence"],
    centroid: [1, 0],
    lastSeen: 123,
  });
  return {
    preferences: preferences.map(item),
    patterns: patterns.map(item),
    workflows: [{ description: "Workflow", steps: ["A", "B", "C"], frequency: 2 }],
    learning_paths: [{ topic: "Topic", chain: ["A"], description: "Path" }],
  };
}

describe("canonicaliseCategories", () => {
  it("chooses the spelling used by most items rather than their frequencies", () => {
    const result = canonicaliseCategories(
      profile([
        "Communication Style",
        "Communication Style",
        "Communication Style",
        "Communication style",
        "Communication style",
      ])
    );
    expect(result.preferences.map((item) => item.category)).toEqual(
      Array(5).fill("Communication Style")
    );
  });

  it("breaks ties by separators, leading capital, then first seen", () => {
    for (const slug of ["communication_style", "communication-style"]) {
      const result = canonicaliseCategories(
        profile([slug, slug, "Communication style", "Communication style"])
      );
      expect(result.preferences.map((item) => item.category)).toEqual(
        Array(4).fill("Communication style")
      );
    }
    expect(
      canonicaliseCategories(
        profile(["communication style", "Communication style"])
      ).preferences.map((item) => item.category)
    ).toEqual(Array(2).fill("Communication style"));
    expect(
      canonicaliseCategories(
        profile(["Communication Style", "Communication style"])
      ).preferences.map((item) => item.category)
    ).toEqual(Array(2).fill("Communication Style"));
  });

  it("counts preferences and patterns together", () => {
    const result = canonicaliseCategories(
      profile(
        ["Communication Style", "Communication Style", "Communication style"],
        ["Communication style", "Communication style"]
      )
    );
    expect([...result.preferences, ...result.patterns].map((item) => item.category)).toEqual(
      Array(5).fill("Communication style")
    );
  });

  it("keeps an established label when a new spelling arrives", () => {
    const result = canonicaliseCategories(
      profile([...Array(50).fill("Communication style"), "communication_style"])
    );
    expect(result.preferences.map((item) => item.category)).toEqual(
      Array(51).fill("Communication style")
    );
  });

  it("keeps a rare readable spelling over frequent hyphenated variants across types", () => {
    const input = profile(Array(5).fill("git-workflow"), ["Git workflow"]);
    const before = structuredClone(input);
    const result = canonicaliseCategories(input);
    expect([...result.preferences, ...result.patterns].map((item) => item.category)).toEqual(
      Array(6).fill("Git workflow")
    );
    expect(input).toEqual(before);
    expect(canonicaliseCategories(result)).toEqual(result);
    expect(result.workflows).toEqual(before.workflows);
    expect(result.preferences.map(({ category: _category, ...rest }) => rest)).toEqual(
      before.preferences.map(({ category: _category, ...rest }) => rest)
    );
    const loneHyphen = profile(["Anti-over-engineering"]);
    expect(canonicaliseCategories(loneHyphen)).toEqual(loneHyphen);
    const onlySeparators = canonicaliseCategories(
      profile(["git-workflow", "git-workflow", "git_workflow"])
    );
    expect(onlySeparators.preferences.map((item) => item.category)).toEqual(
      Array(3).fill("Git-workflow")
    );
  });

  it("keeps a rare readable spelling over frequent underscore variants across types", () => {
    const result = canonicaliseCategories(
      profile(["Writing Standards"], Array(5).fill("writing_standards"))
    );
    expect([...result.preferences, ...result.patterns].map((item) => item.category)).toEqual(
      Array(6).fill("Writing Standards")
    );
    expect(canonicaliseCategories(result)).toEqual(result);
    const properName = canonicaliseCategories(
      profile(Array(5).fill("openspec_conventions"), ["OpenSpec conventions"])
    );
    expect(
      [...properName.preferences, ...properName.patterns].map((item) => item.category)
    ).toEqual(Array(6).fill("OpenSpec conventions"));
  });

  it("keeps the reserved explicit label against a tied capitalised variant", () => {
    const input = profile(["explicit"], ["Explicit"]);
    const before = structuredClone(input);
    const result = canonicaliseCategories(input);
    expect([...result.preferences, ...result.patterns].map((item) => item.category)).toEqual([
      "explicit",
      "explicit",
    ]);
    expect(input).toEqual(before);
    expect(canonicaliseCategories(result)).toEqual(result);
  });

  it("keeps the reserved explicit label against more frequent variants in both types", () => {
    const input = profile(
      ["Explicit", "Explicit", "explicit", "EXPLICIT"],
      ["Explicit", "Explicit", "Explicit", "explicit"]
    );
    const before = structuredClone(input);
    const result = canonicaliseCategories(input);
    expect([...result.preferences, ...result.patterns].map((item) => item.category)).toEqual(
      Array(8).fill("explicit")
    );
    expect(result.preferences.map((item) => item.description)).toEqual(
      before.preferences.map((item) => item.description)
    );
    expect(result.patterns.map((item) => item.frequency)).toEqual(
      before.patterns.map((item) => item.frequency)
    );
    expect(result.workflows).toEqual(before.workflows);
    expect(canonicaliseCategories(result)).toEqual(result);
  });

  it("makes a lone capitalised Explicit the reserved lower-case label", () => {
    const result = canonicaliseCategories(profile(["Explicit"], ["Explicit"]));
    expect([...result.preferences, ...result.patterns].map((item) => item.category)).toEqual([
      "explicit",
      "explicit",
    ]);
  });

  it("does not turn other categories into the reserved label", () => {
    const result = canonicaliseCategories(profile(["Explicit rules", "explicitly"]));
    expect(result.preferences.map((item) => item.category)).toEqual([
      "Explicit rules",
      "Explicitly",
    ]);
  });

  it("tidies labels and changes no other field or input", () => {
    const input = profile(["writing_standards", "UI/UX", "explicit", " "], ["writing-standards"]);
    const before = structuredClone(input);
    const result = canonicaliseCategories(input);
    expect(result.preferences.map((item) => item.category)).toEqual([
      "Writing standards",
      "UI/UX",
      "explicit",
      "General",
    ]);
    expect(result.patterns[0]!.category).toBe("Writing standards");
    const withoutCategories = (data: typeof input) => ({
      ...data,
      preferences: data.preferences.map(({ category: _category, ...rest }) => rest),
      patterns: data.patterns.map(({ category: _category, ...rest }) => rest),
    });
    expect(withoutCategories(result)).toEqual(withoutCategories(before));
    expect(input).toEqual(before);
    expect(canonicaliseCategories(result)).toEqual(result);
  });
});

describe("tidyCategory", () => {
  it("tidies spacing and lower-case labels while preserving capitals and hyphens", () => {
    const cases = [
      ["writing_standards", "Writing standards"],
      ["UI/UX", "UI/UX"],
      ["OpenSpec conventions", "OpenSpec conventions"],
      ["Communication Style", "Communication Style"],
      ["Anti-over-engineering", "Anti-over-engineering"],
      ["  OpenSpec__conventions  ", "OpenSpec conventions"],
      ["", "General"],
      [" ", "General"],
      ["explicit", "explicit"],
    ];
    for (const [input, expected] of cases) {
      expect(tidyCategory(input)).toBe(expected!);
      expect(tidyCategory(tidyCategory(input))).toBe(expected!);
    }
  });
});

describe("categoryKey", () => {
  it("matches spelling variants without changing category meaning", () => {
    for (const label of [
      "Communication_Style",
      "communication-style",
      " Communication style ",
      "Communication Style",
      "Communication   style",
    ]) {
      expect(categoryKey(label)).toBe("communication style");
    }
    expect(categoryKey("UI/UX")).toBe("ui/ux");
    expect(categoryKey("tooling")).not.toBe(categoryKey("testing"));
    expect(categoryKey("")).toBe("general");
    expect(categoryKey("   ")).toBe("general");
  });
});
