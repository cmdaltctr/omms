import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { claimNotice, firstRunNoticeLines } from "../../services/first-run-notice.js";
import type { EnsureResult } from "../../services/web-ensure.js";
import { webStartNotice } from "../../services/web-start-notice.js";

// Pi's start notices: the first-run notice once per computer, and the web-start
// warning once per result per Pi process. Neither blocks the session.

export interface PiNoticeConfig {
  storagePath: string;
  skillStoragePath?: string;
  autoBackfill: boolean;
  webServerAutoStart: boolean;
  embeddingApiUrl?: string;
}

type NoticeContext = Pick<ExtensionContext, "hasUI" | "ui">;

export function createPiStartNotices() {
  const shownResults = new Set<EnsureResult>();
  return {
    /** Shows the first-run notice once per computer. A session without an interface claims nothing. */
    firstRun(ctx: NoticeContext, config: PiNoticeConfig): void {
      if (!ctx.hasUI) return;
      try {
        const lines = firstRunNoticeLines(config, { loginItem: true });
        if (lines.length === 0) return;
        if (!claimNotice("pi", config.skillStoragePath ?? config.storagePath)) return;
        ctx.ui.notify(lines.join("\n"), "info");
      } catch {
        // A failed notice must not stop the session start.
      }
    },
    /** Warns when the web app cannot start, once per result in this process. */
    webStart(ctx: NoticeContext, result: EnsureResult, port: number): void {
      const notice = webStartNotice(result, port);
      if (!notice || !ctx.hasUI || shownResults.has(result)) return;
      shownResults.add(result);
      ctx.ui.notify(notice.text, notice.level);
    },
  };
}
