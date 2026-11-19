import type { Context } from "@opencode/plugin/promise/plugin";
import { log } from "../../services/logger.js";
import { noticeRpc } from "../../v2/notice-rpc.js";

export type OpencodeNotice = {
  readonly title?: string;
  readonly message: string;
  readonly variant?: "info" | "success" | "warning" | "error";
  readonly duration?: number;
};

/**
 * Show a notice from the OpenCode server plugin. The V2 server plugin context has no
 * toast API, so the notice goes to the console, which OpenCode writes to its log.
 */
export function showOpencodeNotice(notice: OpencodeNotice): void {
  const text = [notice.title, notice.message].filter(Boolean).join(": ");
  if (!text) return;
  const method =
    notice.variant === "error" ? "error" : notice.variant === "warning" ? "warn" : "info";
  console[method](`[omms] ${text}`);
}

/**
 * Register the notice channel to the TUI entrypoint (`opencode/tui.tsx`), which shows each
 * notice as a toast. Returns the function that sends one. Without plugin RPC the notice goes
 * to the console, as before. Logs carry the error only, never the notice text.
 */
export async function registerTuiNotices(
  ctx: Pick<Context, "rpc">
): Promise<(notice: OpencodeNotice) => void> {
  try {
    const registration = await ctx.rpc.register(noticeRpc, {});
    const failed = (error: unknown) =>
      log("tui notice: push failed", { error: String(error) }, "error");
    return (notice) => {
      const { title, message, variant } = notice;
      try {
        registration.events.emit("notice", { title, message, variant }).catch(failed);
      } catch (error) {
        failed(error);
      }
    };
  } catch (error) {
    log("tui notice: rpc registration failed", { error: String(error) }, "error");
    return showOpencodeNotice;
  }
}
