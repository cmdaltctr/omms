import {
  CLAUDE_HOOK_EVENTS,
  runClaudeHook,
  type ClaudeHookEvent,
  type ClaudeHookOptions,
} from "./hook-client.js";
import { buildClaudeStatus, loadClaudeStatusInputs, type ClaudeStatusOptions } from "./status.js";

function isHookEvent(value: string | undefined): value is ClaudeHookEvent {
  return (CLAUDE_HOOK_EVENTS as readonly string[]).includes(value ?? "");
}

/** `claude-hook status`: one JSON line for the status line mod. Prints nothing on failure. */
async function printStatus(io: ClaudeHookOptions & ClaudeStatusOptions): Promise<void> {
  const inputs = await (io.statusInputs ?? loadClaudeStatusInputs)();
  const status = await buildClaudeStatus({ ...inputs, fetch: io.fetch ?? globalThis.fetch });
  (io.writeStdout ?? ((text: string) => process.stdout.write(text)))(`${JSON.stringify(status)}\n`);
}

/**
 * `om-memory-system claude-hook <event>`. Always returns 0: a hook must never
 * block or break a Claude Code session, whatever goes wrong.
 */
export async function runClaudeHookCommand(
  argv: string[],
  io: ClaudeHookOptions & ClaudeStatusOptions = {}
): Promise<number> {
  try {
    const [event] = argv;
    if (event === "status") {
      await printStatus(io);
      return 0;
    }
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
