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

/** Notices kept for a TUI that has not confirmed them. Without a TUI the oldest go first. */
const MAX_WAITING_NOTICES = 20;
/** A failed wake-up is sent again this many times, with a growing pause, then left to the next notice. */
const MAX_WAKE_RETRIES = 3;
const WAKE_RETRY_MS = 1_000;

/**
 * Register the notice channel to the TUI entrypoint (`opencode/tui.tsx`), which shows each
 * notice as a toast. Returns the function that sends one. Each notice waits until a TUI claims
 * and confirms it (`ack`), because a TUI that starts later never gets an earlier event
 * (`noticeRpc`). A failed wake-up event is sent again a few times. Without plugin RPC the notice
 * goes to the console, as before. Logs carry the error only, never the notice text.
 */
export async function registerTuiNotices(
  ctx: Pick<Context, "rpc">
): Promise<(notice: OpencodeNotice) => void> {
  type Waiting = { id: number; data: { message: string } };
  const waiting: Waiting[] = [];
  let nextId = 1;
  try {
    const registration = await ctx.rpc.register(noticeRpc, {
      claim: async () => ({ notices: waiting.map(({ id, data }) => ({ ...data, id })) }),
      ack: async (input) => {
        const { ids: sent } = (input ?? {}) as { ids?: unknown };
        const ids = new Set(Array.isArray(sent) ? sent : []);
        for (let i = waiting.length - 1; i >= 0; i--) {
          if (ids.has(waiting[i]!.id)) waiting.splice(i, 1);
        }
        return {};
      },
    });
    const failed = (error: unknown) =>
      log("tui notice: push failed", { error: String(error) }, "error");
    // The wake-up tells a listening TUI to claim. The notice stays queued, so a later retry
    // is pointless once a TUI has confirmed it.
    const wake = (entry: Waiting, attempt: number): void => {
      const retry = (error: unknown) => {
        failed(error);
        if (attempt >= MAX_WAKE_RETRIES || !waiting.includes(entry)) return;
        const timer = setTimeout(() => wake(entry, attempt + 1), WAKE_RETRY_MS * (attempt + 1));
        timer.unref?.();
      };
      try {
        registration.events.emit("notice", entry.data).catch(retry);
      } catch (error) {
        retry(error);
      }
    };
    return (notice) => {
      const { title, message, variant, duration } = notice;
      // OpenCode checks the data against the schema, and a key set to undefined fails it.
      const data = Object.fromEntries(
        Object.entries({ title, message, variant, duration }).filter(([, v]) => v !== undefined)
      ) as { message: string };
      const entry = { id: nextId++, data };
      waiting.push(entry);
      if (waiting.length > MAX_WAITING_NOTICES) waiting.shift();
      wake(entry, 0);
    };
  } catch (error) {
    log("tui notice: rpc registration failed", { error: String(error) }, "error");
    return showOpencodeNotice;
  }
}
