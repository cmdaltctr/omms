import { MAX_PLAN_TURNS, MAX_TURN_CHARS } from "./chat-plan.js";
import type { RetrievedSources } from "./chat-retrieve.js";
import type { ChatRole, ChatSource } from "./chat-types.js";

/** Each source is cut to this many characters in the prompt. Stored snapshots keep it whole. */
export const MAX_SOURCE_CHARS = 2000;

export const ANSWER_TOOL = {
  type: "function",
  function: {
    name: "answer",
    description: "Answer the question from the numbered sources",
    parameters: {
      type: "object",
      properties: {
        answer: {
          type: "string",
          description: "The answer, with a marker such as [S1] or [P2] after each claim",
        },
        citations: { type: "array", items: { type: "string" } },
        insufficient: {
          type: "boolean",
          description: "True when the sources do not answer the question",
        },
      },
      required: ["answer", "citations", "insufficient"],
    },
  },
} as const;

const SYSTEM = [
  "You answer questions about one user's saved memories of past coding sessions and their profile.",
  "Use only the numbered sources given. Do not use outside knowledge.",
  "Put the source marker, such as [S1] or [P2], after each claim it supports.",
  "When the sources do not answer the question, say so briefly and set insufficient to true.",
  "Write plain, short British English. Call the answer tool.",
].join(" ");

const SKILL_SYSTEM =
  "Sources marked K, such as [K1], are facts about one agent skill: uses, failed turns, whether it was changed, and its recent changes. Cite them like any other source.";

export function numberSources(found: RetrievedSources): ChatSource[] {
  return [
    ...found.memories.map((source, i) => ({ ...source, label: `S${i + 1}` })),
    ...found.profile.map((source, i) => ({ ...source, label: `P${i + 1}` })),
    ...(found.skills ?? []).map((source, i) => ({ ...source, label: `K${i + 1}` })),
  ];
}

function describeSource(source: ChatSource): string {
  if (source.kind === "skill") return `[${source.label}] ${source.text.slice(0, MAX_SOURCE_CHARS)}`;
  const meta =
    source.kind === "memory"
      ? [source.projectName, source.tags?.length ? `tags: ${source.tags.join(", ")}` : ""]
      : [source.section, source.category];
  const header = meta.filter(Boolean).join("; ");
  return `[${source.label}] ${source.text.slice(0, MAX_SOURCE_CHARS)}${header ? `\n(${header})` : ""}`;
}

export function buildAnswerPrompt(
  question: string,
  turns: Array<{ role: ChatRole; content: string }>,
  sources: ChatSource[]
): { system: string; user: string } {
  const history = turns
    .slice(-MAX_PLAN_TURNS)
    .map((turn) => `${turn.role}: ${turn.content.slice(0, MAX_TURN_CHARS)}`);
  const user = [
    history.length ? `Earlier turns:\n${history.join("\n")}` : "",
    `Sources:\n${sources.map(describeSource).join("\n\n")}`,
    `Question: ${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const system = sources.some((source) => source.kind === "skill")
    ? `${SYSTEM} ${SKILL_SYSTEM}`
    : SYSTEM;
  return { system, user };
}

const MARKER = /\s*\[([SPK]\d+)\]/g;

/**
 * Removes `[S9]`-style markers that name a source that was not sent, and lists
 * the valid ones in order of first use. Other bracketed text is left alone.
 */
export function validateCitations(
  answer: string,
  sentLabels: string[]
): { text: string; cited: string[] } {
  const sent = new Set(sentLabels);
  const cited: string[] = [];
  const text = answer
    .replace(MARKER, (match, label: string) => {
      if (!sent.has(label)) return "";
      if (!cited.includes(label)) cited.push(label);
      return match;
    })
    .trim();
  return { text, cited };
}

export interface FinalAnswer {
  text: string;
  cited: string[];
  insufficient: boolean;
  /** True when a full answer cites no valid source; the page shows a note. */
  uncited: boolean;
}

/** The checked answer, or null when the reply holds no answer text. */
export function finaliseAnswer(raw: unknown, sources: ChatSource[]): FinalAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const reply = raw as Record<string, unknown>;
  if (typeof reply.answer !== "string" || !reply.answer.trim()) return null;
  const insufficient = reply.insufficient === true;
  const { text, cited } = validateCitations(
    reply.answer,
    sources.map((source) => source.label)
  );
  return { text, cited, insufficient, uncited: !insufficient && cited.length === 0 };
}
