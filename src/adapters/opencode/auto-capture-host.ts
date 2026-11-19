import { CONFIG } from "../../config.js";
import type { AutoCaptureHost, AutoCaptureNotification } from "../../core/host.js";
import { extractOpenCodeConversation } from "./conversation.js";
import { generateOpenCodeAutoCaptureSummary } from "./auto-capture-summary.js";
import type { OpencodeHost } from "./opencode-host.js";
import { showOpencodeNotice, type OpencodeNotice } from "./toast.js";

/** `show` sends capture notices; the V2 plugin passes the TUI channel (`registerTuiNotices`). */
export function createOpenCodeAutoCaptureHost(
  host: Pick<OpencodeHost, "session">,
  show: (notice: OpencodeNotice) => void = showOpencodeNotice
): AutoCaptureHost {
  const notify = async (notification: AutoCaptureNotification): Promise<void> => {
    show(notification);
  };

  return {
    host: "opencode",
    isCaptureReady: () => CONFIG.autoCaptureProviderStatus.ready,
    getConversation: async (sessionId, promptMessageId) => {
      const messages = await host.session.context({ sessionID: sessionId } as never);
      return extractOpenCodeConversation(messages as readonly unknown[], promptMessageId);
    },
    summarize: (request) => generateOpenCodeAutoCaptureSummary(request, notify),
    notify,
  };
}
