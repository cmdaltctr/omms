import type { PluginInput } from "@opencode-ai/plugin";
import { CONFIG } from "../../config.js";
import type { AutoCaptureHost, AutoCaptureNotification } from "../../core/host.js";
import { extractOpenCodeConversation } from "./conversation.js";
import { generateOpenCodeAutoCaptureSummary } from "./auto-capture-summary.js";

export function createOpenCodeAutoCaptureHost(ctx: PluginInput): AutoCaptureHost {
  const notify = async (notification: AutoCaptureNotification): Promise<void> => {
    if (!ctx.client?.tui) return;
    await ctx.client.tui
      .showToast({
        body: notification,
      })
      .then(() => undefined)
      .catch(() => undefined);
  };

  return {
    host: "opencode",
    isCaptureReady: () => CONFIG.autoCaptureProviderStatus.ready,
    getConversation: async (sessionId, promptMessageId) => {
      if (!ctx.client) throw new Error("Client not available");
      const response = await ctx.client.session.messages({ path: { id: sessionId } });
      if (!response.data) return null;
      return extractOpenCodeConversation(response.data as any[], promptMessageId);
    },
    summarize: (request) => generateOpenCodeAutoCaptureSummary(request, notify),
    notify,
  };
}
