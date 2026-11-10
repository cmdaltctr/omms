import type { CaptureMemoriseState, CaptureToolCall } from "./host.js";

/**
 * A memorisation reaches an agent only through `recall`. A turn in which the
 * agent saved one must not also be captured as an ordinary memory, or the
 * snapshot would come back through per-prompt recall. The host readers set
 * `memorise` on each tool call from the raw arguments and the result; the
 * detector reads only that field. No result text is kept.
 */

// The OMMS memory tool: bare on OpenCode and Pi, `mcp__<server>__memory` on Claude Code.
const MEMORY_TOOL = /^(?:mcp__[\w-]*omms[\w-]*__)?memory$/;
const MEMORISE_MODES = new Set(["memorise", "memorize"]);
// `om-memory-system memory memorise`, with or without `npx`, flags before the mode word.
const CLI_MEMORISE = /\bom-memory-system\b[^|;&\n]*?\bmemory\s+(?:memorise|memorize)\b/;

function recordOf(args: unknown): Record<string, unknown> | undefined {
  let value = args;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `unknown` for a memorise call (a result still has to answer it), otherwise undefined. */
export function memoriseCallState(name: string, args: unknown): "unknown" | undefined {
  const record = recordOf(args);
  if (!record) return undefined;
  if (MEMORY_TOOL.test(name)) {
    const mode = typeof record.mode === "string" ? record.mode.trim().toLowerCase() : "";
    return MEMORISE_MODES.has(mode) ? "unknown" : undefined;
  }
  if (name.toLowerCase() === "bash") {
    const command = record.command;
    return typeof command === "string" && CLI_MEMORISE.test(command) ? "unknown" : undefined;
  }
  return undefined;
}

/**
 * The state a result gives a memorise call. A host error, or a JSON reply with
 * `success: false`, is `failed`. The memory tool reports its own failures as a
 * normal reply with `success: false`, so the host does not always mark them.
 */
export function memoriseResultState(isError: boolean, text: string): CaptureMemoriseState {
  if (isError) return "failed";
  try {
    const reply: unknown = JSON.parse(text.trim());
    if (reply && typeof reply === "object" && (reply as { success?: unknown }).success === false) {
      return "failed";
    }
  } catch {
    // Not JSON: the host reported no error, so the call counts as saved.
  }
  return "saved";
}

/** True when any call in the turn saved a memorisation. */
export function turnSavedMemorisation(toolCalls: readonly CaptureToolCall[]): boolean {
  return toolCalls.some((call) => call.memorise === "saved");
}
