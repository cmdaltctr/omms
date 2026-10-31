import { describe, expect, it } from "bun:test";
import {
  MAX_PLAN_TAGS,
  MAX_PLAN_SKILLS,
  PLAN_TOOL,
  PLAN_TOOL_WITH_SKILLS,
  buildPlanPrompt,
  planTool,
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

// A fixed copy of the gate-off text. If a word of the skill text leaks into the
// prompt or the tool while no skill names are given, these comparisons fail.
const GATE_OFF_SYSTEM = [
  "You plan a search over one user's saved memories of past coding sessions and their profile.",
  "Return 1 to 3 short search phrases that would find memories answering the question.",
  "Resolve follow-up questions with the earlier turns, so each phrase stands alone.",
  "Pick tags and profile categories only from the lists given. Pick none when none fit.",
  "Call plan_search. Do not answer the question.",
].join(" ");

const GATE_OFF_TOOL = {
  type: "function",
  function: {
    name: "plan_search",
    description: "Choose how to search the user's stored memories and profile",
    parameters: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description: "1 to 3 short search phrases",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags from the given list that match the question",
        },
        profileCategories: {
          type: "array",
          items: { type: "string" },
          description: "Profile categories from the given list that match the question",
        },
      },
      required: ["queries", "tags", "profileCategories"],
    },
  },
};

describe("plan with the skill gate off", () => {
  it("sends exactly today's system and user text", () => {
    const { system, user } = buildPlanPrompt(base);
    expect(system).toBe(GATE_OFF_SYSTEM);
    expect(user).toBe(
      [
        "Earlier turns: none",
        "Tags (count): bun (9), Claude-Code (4)",
        "Profile categories: Tooling, Workflow",
        "Question: Why does bun install fail?",
      ].join("\n\n")
    );
    expect(`${system} ${user}`.toLowerCase()).not.toContain("skill");
  });

  it("uses today's plan tool", () => {
    expect(PLAN_TOOL).toEqual(GATE_OFF_TOOL);
    expect(planTool(false)).toBe(PLAN_TOOL);
  });

  it("saves no skill fields", () => {
    const plan = validatePlan(
      { queries: ["q"], tags: [], skills: ["a"], skillIntent: "needs-work" },
      base
    );
    expect(Object.keys(plan).sort()).toEqual(["profileCategories", "queries", "skipped", "tags"]);
  });
});

describe("plan with skill names", () => {
  const withSkills = { ...base, skills: ["s-web-search", "Review", "plain"] };

  it("lists the names and asks for skills and a skill intent", () => {
    const { system, user } = buildPlanPrompt(withSkills);
    expect(user).toContain("Skills: s-web-search, Review, plain");
    expect(system).toContain("skillIntent");
  });

  it("sends at most 100 names", () => {
    const skills = Array.from({ length: 130 }, (_, i) => `skill-${i}`);
    const { user } = buildPlanPrompt({ ...base, skills });
    expect(MAX_PLAN_SKILLS).toBe(100);
    expect(user).toContain("skill-99");
    expect(user).not.toContain("skill-100,");
    expect(user).not.toContain("skill-100\n");
  });

  it("adds optional skills and skillIntent to the tool", () => {
    const tool = planTool(true);
    expect(tool).toBe(PLAN_TOOL_WITH_SKILLS);
    const params = tool.function.parameters;
    expect(Object.keys(params.properties)).toContain("skills");
    expect(Object.keys(params.properties)).toContain("skillIntent");
    expect(params.required).toEqual(["queries", "tags", "profileCategories"]);
  });

  it("drops unknown names, keeps stored spelling, and turns an unknown intent into none", () => {
    const plan = validatePlan(
      { queries: ["q"], tags: [], skills: ["REVIEW", "made-up"], skillIntent: "sideways" },
      withSkills
    );
    expect(plan.skills).toEqual(["Review"]);
    expect(plan.skillIntent).toBe("none");
  });

  it("keeps a valid intent", () => {
    const plan = validatePlan({ queries: ["q"], skillIntent: "needs-work" }, withSkills);
    expect(plan.skillIntent).toBe("needs-work");
    expect(plan.skills).toEqual([]);
  });

  it("gives a skipped plan no skill fields", () => {
    const plan = validatePlan(null, withSkills);
    expect(plan.skipped).toBe(true);
    expect(plan.skills).toBeUndefined();
    expect(plan.skillIntent).toBeUndefined();
  });
});
