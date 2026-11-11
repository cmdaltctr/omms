import { CONFIG } from "../../config.js";
import type { AutoCaptureHost, AutoCaptureNotification } from "../../core/host.js";
import { extractOpenCodeConversation } from "./conversation.js";
import { generateOpenCodeAutoCaptureSummary } from "./auto-capture-summary.js";
import type { OpencodeHost } from "./opencode-host.js";
import { showOpencodeNotice } from "./toast.js";

export function createOpenCodeAutoCaptureHost(
  host: Pick<OpencodeHost, "session">
): AutoCaptureHost {
  const notify = async (notification: AutoCaptureNotification): Promise<void> => {
    showOpencodeNotice(notification);
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
