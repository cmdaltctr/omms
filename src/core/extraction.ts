import { z } from "zod";
import type { CaptureSummary } from "./host.js";

/**
 * Shared structured-extraction contract for automatic capture.
 *
 * Both host adapters (OpenCode provider path and the Pi model bridge) request
 * the same summary shape and validate model output against this schema so the
 * downstream capture pipeline always receives well-formed results.
 */
export const captureSummarySchema = z.object({
  summary: z.string(),
  type: z.string(),
  tags: z.array(z.string()),
});

/**
 * JSON schema description embedded into the summary request prompt. Kept as a
 * plain object so it can be passed to hosts that take a tool-schema style
 * description (OpenCode fallback path, Pi bridge prompt).
 */
export const captureSummaryToolSchema = {
  type: "object" as const,
  properties: {
    summary: {
      type: "string",
      description: "Markdown-formatted summary of the conversation",
    },
    type: {
      type: "string",
      description:
        "Type of memory: 'skip' for non-technical conversations, or technical type (feature, bug-fix, refactor, analysis, configuration, discussion, other)",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "List of 2-4 technical tags related to the memory",
    },
  },
  required: ["summary", "type", "tags"],
};

export function buildCaptureSystemPrompt(languageName: string): string {
  return `You are a technical memory recorder for a software development project.

RULES:
1. ONLY capture technical work (code, bugs, features, architecture, config)
2. SKIP non-technical by returning type="skip"
3. NO meta-commentary or behavior analysis
4. Include specific file names, functions, technical details
5. Generate 2-4 technical tags (e.g., "react", "auth", "bug-fix")
6. You MUST write the summary in ${languageName}.

FORMAT:
## Request
[1-2 sentences: what was requested, in ${languageName}]

## Outcome
[1-2 sentences: what was done, include files/functions, in ${languageName}]

SKIP if: greetings, casual chat, no code/decisions made
CAPTURE if: code changed, bug fixed, feature added, decision made`;
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to fenced-block extraction
    }
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      return null;
    }
  }
  const braceStart = trimmed.indexOf("{");
  const braceEnd = trimmed.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(trimmed.slice(braceStart, braceEnd + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parse and validate a model reply as a capture summary. Tolerates fenced code
 * blocks and surrounding prose. Returns null when no valid payload is present.
 */
export function parseCaptureSummary(raw: string): CaptureSummary | null {
  const parsed = captureSummarySchema.safeParse(extractJsonObject(raw));
  if (!parsed.success) return null;
  return {
    summary: parsed.data.summary,
    type: parsed.data.type,
    tags: parsed.data.tags.map((tag) => tag.toLowerCase().trim()).filter(Boolean),
  };
}
