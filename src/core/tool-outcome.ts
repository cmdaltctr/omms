import type { CaptureToolCall } from "./host.js";
import { memoriseCallState, memoriseResultState } from "./memorise-turn.js";

export const MAX_TOOL_ERROR_LENGTH = 2000;

type ToolOutcomeFields = Pick<CaptureToolCall, "outcome" | "error">;

/** Error text as the host reported it, cut to at most 2,000 characters. */
export function boundToolError(text: string): string {
  return text.length > MAX_TOOL_ERROR_LENGTH ? text.slice(0, MAX_TOOL_ERROR_LENGTH) : text;
}

/** The outcome of a failed call, with its error text when the host gave one. */
export function errorOutcome(text: unknown): ToolOutcomeFields {
  const error = typeof text === "string" ? text.trim() : "";
  return error ? { outcome: "error", error: boundToolError(error) } : { outcome: "error" };
}

/**
 * The outcome of an OpenCode tool part from its `state`. The live reader and
 * the history import read the same part shape.
 */
export function opencodeToolOutcome(state: unknown): ToolOutcomeFields {
  const { status, error } = (state && typeof state === "object" ? state : {}) as {
    status?: unknown;
    error?: unknown;
  };
  if (status === "completed") return { outcome: "ok" };
  if (status === "error") return errorOutcome(error);
  return { outcome: "unknown" };
}

/**
 * The text an OpenCode tool part returned: V1 keeps it in `state.output`, the
 * V2 plugin API in `state.content` text items. Used only to read a memorise
 * reply; it is never stored.
 */
function opencodeToolText(state: Record<string, unknown>): string {
  if (typeof state.output === "string") return state.output;
  if (!Array.isArray(state.content)) return "";
  return state.content
    .map((item) => (item && typeof item === "object" ? (item as { text?: unknown }).text : null))
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

/**
 * The `memorise` field for an OpenCode tool part, or nothing for any other
 * call. A completed call is `saved` or `failed` by its reply, an errored call
 * is `failed`, and a call still running is `unknown`.
 */
export function opencodeMemorise(
  name: string,
  args: unknown,
  state: unknown
): Pick<CaptureToolCall, "memorise"> {
  if (!memoriseCallState(name, args)) return {};
  const fields = (state && typeof state === "object" ? state : {}) as Record<string, unknown>;
  if (fields.status === "error") return { memorise: "failed" };
  if (fields.status !== "completed") return { memorise: "unknown" };
  return { memorise: memoriseResultState(false, opencodeToolText(fields)) };
}
