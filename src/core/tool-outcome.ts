import type { CaptureToolCall } from "./host.js";

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
