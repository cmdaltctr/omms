import { noticeRpc } from "../../v2/notice-rpc.js";

/** The slice of the TUI context this module uses. */
export interface TuiNoticesDeps {
  client: {
    rpc(definition: typeof noticeRpc): {
      events: { on(name: "notice", handler: (event: any) => void): unknown };
    };
  };
  toast: (options: {
    title?: string;
    message: string;
    variant?: "info" | "success" | "warning" | "error";
    duration: number;
  }) => void;
}

/**
 * Show each notice the server plugin sends over `noticeRpc` as a TUI toast. A failing toast
 * draws nothing and never throws into the host. Returns a stop function.
 */
export function startTuiNotices(deps: TuiNoticesDeps): () => void {
  const off = deps.client.rpc(noticeRpc).events.on("notice", (event) => {
    const { title, message, variant } = event?.data ?? {};
    if (typeof message !== "string" || !message) return;
    try {
      deps.toast({ title, message, variant, duration: 10_000 });
    } catch {
      // A failed toast must not break the TUI.
    }
  });
  return () => {
    if (typeof off === "function") off();
  };
}
