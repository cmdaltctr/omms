import { noticeRpc } from "../../v2/notice-rpc.js";

type Notice = {
  title?: string;
  message: string;
  variant?: "info" | "success" | "warning" | "error";
  duration?: number;
};

/** The slice of the TUI context this module uses. */
export interface TuiNoticesDeps {
  client: {
    rpc(definition: typeof noticeRpc): {
      claim(input: Record<string, never>): Promise<{ notices: Notice[] }>;
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
 * Show each notice the server plugin sends over `noticeRpc` as a TUI toast. The TUI claims the
 * waiting notices when it loads and again on each `notice` event, one claim at a time, so each
 * notice shows once and in order, including those sent before the TUI started. A failing claim
 * or toast draws nothing and never throws into the host. Returns a stop function.
 */
export function startTuiNotices(deps: TuiNoticesDeps): () => void {
  const rpc = deps.client.rpc(noticeRpc);
  let stopped = false;
  let claiming = false;
  let again = false;

  const show = (notice: Notice) => {
    const { title, message, variant, duration } = notice ?? {};
    if (typeof message !== "string" || !message) return;
    try {
      deps.toast({ title, message, variant, duration: duration ?? 10_000 });
    } catch {
      // A failed toast must not break the TUI.
    }
  };

  const claim = async () => {
    if (claiming) {
      again = true;
      return;
    }
    claiming = true;
    try {
      do {
        again = false;
        const { notices } = await rpc.claim({});
        if (stopped) return;
        for (const notice of notices ?? []) show(notice);
      } while (again && !stopped);
    } catch {
      // The server plugin has not registered yet; its first notice event claims again.
    } finally {
      claiming = false;
      // A notice event that came during a failed claim still gets its claim.
      if (again && !stopped) void claim();
    }
  };

  // Listen first, so a notice sent while the first claim runs claims again.
  const off = rpc.events.on("notice", () => void claim());
  void claim();
  return () => {
    stopped = true;
    if (typeof off === "function") off();
  };
}
