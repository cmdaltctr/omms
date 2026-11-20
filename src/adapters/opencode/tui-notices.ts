import { noticeRpc } from "../../v2/notice-rpc.js";

type Notice = {
  id?: number;
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
      ack(input: { ids: number[] }): Promise<unknown>;
      events: { on(name: "notice", handler: (event: any) => void): unknown };
    };
  };
  toast: (options: {
    title?: string;
    message: string;
    variant?: "info" | "success" | "warning" | "error";
    duration: number;
  }) => void;
  /** Pause before a failed claim, toast or confirmation is tried again. Tests shorten it. */
  retryDelayMs?: number;
}

/** A failed claim, toast or confirmation is tried again this many times in a row. */
const MAX_RETRIES = 5;

/**
 * Show each notice the server plugin sends over `noticeRpc` as a TUI toast. The TUI claims the
 * waiting notices when it loads and again on each `notice` event, one claim at a time, so each
 * notice shows once and in order, including those sent before the TUI started. The server keeps a
 * notice until the TUI confirms it (`ack`) after the toast shows. A failed claim, toast or
 * confirmation is tried again on a short timer, up to `MAX_RETRIES` times in a row. A failure
 * draws nothing and never throws into the host. Returns a stop function that also cancels the timer.
 */
export function startTuiNotices(deps: TuiNoticesDeps): () => void {
  const rpc = deps.client.rpc(noticeRpc);
  const retryDelayMs = deps.retryDelayMs ?? 2_000;
  let stopped = false;
  let claiming = false;
  let again = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Notices already on screen whose confirmation has not reached the server, so a retry does not show them twice.
  const shown = new Set<number>();

  /** Returns false when the toast failed, so the notice stays on the server for the next claim. */
  const show = (notice: Notice): boolean => {
    const { title, message, variant, duration } = notice ?? {};
    if (typeof message !== "string" || !message) return true;
    try {
      deps.toast({ title, message, variant, duration: duration ?? 10_000 });
      return true;
    } catch {
      // A failed toast must not break the TUI.
      return false;
    }
  };

  const retryLater = () => {
    if (stopped || timer || retries >= MAX_RETRIES) return;
    retries++;
    timer = setTimeout(() => {
      timer = undefined;
      void claim();
    }, retryDelayMs);
  };

  const claim = async () => {
    if (claiming) {
      again = true;
      return;
    }
    claiming = true;
    let ok = true;
    try {
      do {
        again = false;
        const { notices } = await rpc.claim({});
        if (stopped) return;
        const done: number[] = [];
        for (const notice of notices ?? []) {
          const id = typeof notice?.id === "number" ? notice.id : undefined;
          if (id !== undefined && shown.has(id)) done.push(id);
          else if (show(notice)) {
            if (id !== undefined) {
              shown.add(id);
              done.push(id);
            }
          } else {
            // Stop at the first failed toast, so the retry shows the rest in server order.
            ok = false;
            break;
          }
        }
        if (done.length > 0) {
          try {
            await rpc.ack({ ids: done });
            for (const id of done) shown.delete(id);
          } catch {
            ok = false;
          }
        }
      } while (again && !stopped);
    } catch {
      // The server plugin has not registered yet.
      ok = false;
    } finally {
      claiming = false;
      if (ok) retries = 0;
      else retryLater();
      // A notice event that came during a failed claim still gets its claim.
      if (again && !stopped) void claim();
    }
  };

  // Listen first, so a notice sent while the first claim runs claims again.
  const off = rpc.events.on("notice", () => {
    retries = 0;
    void claim();
  });
  void claim();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (typeof off === "function") off();
  };
}
