import type { ChatPlanRecord, ChatRole, SkillIntent } from "./chat-types.js";

export const MAX_PLAN_TAGS = 200;
export const MAX_PLAN_TURNS = 6;
export const MAX_TURN_CHARS = 500;
export const MAX_PLAN_QUERIES = 3;
/** Skill names offered to the plan model, most used first. */
export const MAX_PLAN_SKILLS = 100;

const SKILL_INTENTS: readonly SkillIntent[] = ["none", "needs-work", "most-used"];

export interface PlanInput {
  question: string;
  turns: Array<{ role: ChatRole; content: string }>;
  tags: Array<{ keyword: string; count: number }>;
  categories: string[];
  /** Safe skill names, most used first. Absent while skill facts are off. */
  skills?: string[];
}

export const PLAN_TOOL = {
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
} as const;

/** The plan tool while skill facts are on: two optional fields on top of `PLAN_TOOL`. */
export const PLAN_TOOL_WITH_SKILLS = {
  type: "function",
  function: {
    ...PLAN_TOOL.function,
    parameters: {
      ...PLAN_TOOL.function.parameters,
      properties: {
        ...PLAN_TOOL.function.parameters.properties,
        skills: {
          type: "array",
          items: { type: "string" },
          description: "Skills from the given list that the question names or is about",
        },
        skillIntent: {
          type: "string",
          enum: [...SKILL_INTENTS],
          description:
            "needs-work for skills that fail or need care, most-used for skills used most, otherwise none",
        },
      },
    },
  },
} as const;

export function planTool(withSkills: boolean): typeof PLAN_TOOL | typeof PLAN_TOOL_WITH_SKILLS {
  return withSkills ? PLAN_TOOL_WITH_SKILLS : PLAN_TOOL;
}

const SYSTEM = [
  "You plan a search over one user's saved memories of past coding sessions and their profile.",
  "Return 1 to 3 short search phrases that would find memories answering the question.",
  "Resolve follow-up questions with the earlier turns, so each phrase stands alone.",
  "Pick tags and profile categories only from the lists given. Pick none when none fit.",
  "Call plan_search. Do not answer the question.",
].join(" ");

const SKILL_SYSTEM = [
  "The question may also be about the user's agent skills.",
  "Pick skills only from the Skills list. Set skillIntent to needs-work for questions about skills that fail or need care,",
  "to most-used for questions about the skills used most, and to none otherwise.",
].join(" ");

function topTags(tags: PlanInput["tags"]): PlanInput["tags"] {
  return [...tags].sort((a, b) => b.count - a.count).slice(0, MAX_PLAN_TAGS);
}

export function buildPlanPrompt(input: PlanInput): { system: string; user: string } {
  const turns = input.turns
    .slice(-MAX_PLAN_TURNS)
    .map((turn) => `${turn.role}: ${turn.content.slice(0, MAX_TURN_CHARS)}`);
  const tags = topTags(input.tags).map((tag) => `${tag.keyword} (${tag.count})`);
  const categories = [...new Set(input.categories)];
  const skills = input.skills ? [...new Set(input.skills)].slice(0, MAX_PLAN_SKILLS) : null;
  const user = [
    turns.length ? `Earlier turns:\n${turns.join("\n")}` : "Earlier turns: none",
    `Tags (count): ${tags.length ? tags.join(", ") : "none"}`,
    `Profile categories: ${categories.length ? categories.join(", ") : "none"}`,
    ...(skills ? [`Skills: ${skills.length ? skills.join(", ") : "none"}`] : []),
    `Question: ${input.question}`,
  ].join("\n\n");
  return { system: skills ? `${SYSTEM} ${SKILL_SYSTEM}` : SYSTEM, user };
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Keep the picks that exist in `allowed`, ignoring case, in the stored spelling. */
function known(picks: string[], allowed: string[]): string[] {
  const byKey = new Map(allowed.map((value) => [value.toLowerCase(), value]));
  const out: string[] = [];
  for (const pick of picks) {
    const match = byKey.get(pick.toLowerCase());
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}

/**
 * The model's plan with unknown tags and categories removed. A missing or
 * broken plan searches with the question alone and is marked skipped.
 */
export function validatePlan(raw: unknown, input: PlanInput): ChatPlanRecord {
  const plan = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const queries = strings(plan.queries).slice(0, MAX_PLAN_QUERIES);
  if (queries.length === 0) {
    return { queries: [input.question], tags: [], profileCategories: [], skipped: true };
  }
  const record: ChatPlanRecord = {
    queries,
    tags: known(
      strings(plan.tags),
      topTags(input.tags).map((tag) => tag.keyword)
    ),
    profileCategories: known(strings(plan.profileCategories), input.categories),
    skipped: false,
  };
  if (input.skills) {
    record.skills = known(strings(plan.skills), input.skills.slice(0, MAX_PLAN_SKILLS));
    record.skillIntent = SKILL_INTENTS.find((intent) => intent === plan.skillIntent) ?? "none";
  }
  return record;
}
