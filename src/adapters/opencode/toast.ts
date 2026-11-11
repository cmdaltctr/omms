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
