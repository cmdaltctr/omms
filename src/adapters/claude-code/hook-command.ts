import {
  CLAUDE_HOOK_EVENTS,
  runClaudeHook,
  type ClaudeHookEvent,
  type ClaudeHookOptions,
} from "./hook-client.js";

function isHookEvent(value: string | undefined): value is ClaudeHookEvent {
  return (CLAUDE_HOOK_EVENTS as readonly string[]).includes(value ?? "");
}

/**
 * `om-memory-system claude-hook <event>`. Always returns 0: a hook must never
 * block or break a Claude Code session, whatever goes wrong.
 */
export async function runClaudeHookCommand(
  argv: string[],
  io: ClaudeHookOptions = {}
): Promise<number> {
  try {
    const [event] = argv;
    if (isHookEvent(event)) {
      await runClaudeHook(event, io);
      return 0;
    }
    // Only a known name reaches the log; argv is not trusted text.
    const log =
      io.log ??
      (async (message: string, data: Record<string, unknown>) =>
        (await import("../../services/logger.js")).log(message, data));
    await log("Claude Code hook", { event: "unknown", code: "bad-event" });
  } catch {
    /* Exit 0 on every failure. */
  }
  return 0;
}
