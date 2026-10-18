import { describe, expect, it } from "bun:test";
import {
  MAX_PLAN_TAGS,
  PLAN_TOOL,
  buildPlanPrompt,
  validatePlan,
} from "../src/services/chat/chat-plan.js";

const base = {
  question: "Why does bun install fail?",
  turns: [] as Array<{ role: "user" | "assistant"; content: string }>,
  tags: [
    { keyword: "bun", count: 9 },
    { keyword: "Claude-Code", count: 4 },
  ],
  categories: ["Tooling", "Workflow"],
};

describe("buildPlanPrompt", () => {
  it("holds the question, the tags with counts, and the categories", () => {
    const { user } = buildPlanPrompt(base);
    expect(user).toContain("Why does bun install fail?");
    expect(user).toContain("bun (9)");
    expect(user).toContain("Tooling");
    expect(user).toContain("Workflow");
  });

  it("keeps the last 6 turns, each cut to 500 characters", () => {
    const turns = Array.from({ length: 9 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      content: `turn-${i} ` + "x".repeat(600),
    }));
    const { user } = buildPlanPrompt({ ...base, turns });
    expect(user).not.toContain("turn-2 ");
    expect(user).toContain("turn-3 ");
    expect(user).toContain("turn-8 ");
    expect(user).not.toContain("x".repeat(501));
  });

  it("sends at most 200 tags, the most frequent first", () => {
    const tags = Array.from({ length: 250 }, (_, i) => ({ keyword: `tag${i}`, count: i }));
    const { user } = buildPlanPrompt({ ...base, tags });
    expect(MAX_PLAN_TAGS).toBe(200);
    expect(user).toContain("tag249 (249)");
    expect(user).toContain("tag50 (50)");
    expect(user).not.toContain("tag49 (49)");
  });

  it("names the plan tool", () => {
    expect(PLAN_TOOL.function.name).toBe("plan_search");
  });
});

describe("validatePlan", () => {
  it("drops unknown tags and categories, ignoring case, and keeps stored spelling", () => {
    const plan = validatePlan(
      {
        queries: ["bun install error"],
        tags: ["BUN", "made-up-tag", "claude-code"],
        profileCategories: ["tooling", "Invented"],
      },
      base
    );
    expect(plan).toEqual({
      queries: ["bun install error"],
      tags: ["bun", "Claude-Code"],
      profileCategories: ["Tooling"],
      skipped: false,
    });
  });

  it("caps queries at 3 and drops blank ones", () => {
    const plan = validatePlan({ queries: [" a ", "", "b", "c", "d"], tags: [] }, base);
    expect(plan.queries).toEqual(["a", "b", "c"]);
  });

  it("falls back to the question when the plan is empty or broken", () => {
    for (const raw of [null, undefined, "nope", {}, { queries: [] }, { queries: [5] }]) {
      expect(validatePlan(raw, base)).toEqual({
        queries: ["Why does bun install fail?"],
        tags: [],
        profileCategories: [],
        skipped: true,
      });
    }
  });
});
