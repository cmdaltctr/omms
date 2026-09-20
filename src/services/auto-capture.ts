import { CONFIG } from "../config.js";
import { captureConversation } from "../core/capture.js";
import type { AutoCaptureHost } from "../core/host.js";
import { log } from "./logger.js";
import { userPromptManager, type UserPrompt } from "./user-prompt/user-prompt-manager.js";

export {
  buildBoundedSummaryPrompt,
  buildMarkdownContext,
  getAutoCaptureMarkdownBudget,
} from "../core/capture-context.js";

const RETRY_BASE_DELAY_MS = 2000;
let isCaptureRunning = false;

async function notifySafely(
  host: AutoCaptureHost,
  notification: Parameters<NonNullable<AutoCaptureHost["notify"]>>[0]
): Promise<void> {
  try {
    await host.notify?.(notification);
  } catch {
    // Host UI failures must never affect memory capture.
  }
}

export async function performAutoCapture(
  host: AutoCaptureHost,
  sessionID: string,
  directory: string
): Promise<void> {
  if (isCaptureRunning) return;
  isCaptureRunning = true;

  try {
    const prompts = await userPromptManager.getUncapturedPromptsForSession(sessionID);
    if (prompts.length === 0 || !host.isCaptureReady()) return;

    const maxRetries = CONFIG.autoCaptureMaxRetries ?? 3;
    for (const prompt of prompts) {
      await capturePrompt(host, sessionID, directory, prompt, maxRetries);
    }
  } finally {
    isCaptureRunning = false;
  }
}

async function capturePrompt(
  host: AutoCaptureHost,
  sessionID: string,
  directory: string,
  prompt: UserPrompt,
  maxRetries: number
): Promise<void> {
  let claimedPromptId: string | null = null;
  let attempt = prompt.capture_attempts || 0;

  try {
    if (!(await userPromptManager.claimPrompt(prompt.id))) return;
    claimedPromptId = prompt.id;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const conversation = await host.getConversation(sessionID, prompt.messageId);
        if (!conversation) return;
        if (conversation.textResponses.length === 0 && conversation.toolCalls.length === 0) return;

        const captureResult = await captureConversation(
          {
            host: host.host,
            hostSessionId: sessionID,
            sourceType: "live-capture",
            projectDirectory: directory,
            userPrompt: prompt.content,
            promptId: prompt.id,
            prompt: {
              id: prompt.id,
              providerId: prompt.providerId,
              modelId: prompt.modelId,
            },
            ...conversation,
          },
          host
        );

        if (captureResult.status === "skipped") {
          log("Auto-capture skipped", {
            promptId: prompt.id,
            sessionID,
            type: captureResult.type,
          });
          await userPromptManager.deletePrompt(prompt.id);
          claimedPromptId = null;
          return;
        }

        await userPromptManager.linkMemoryToPrompt(prompt.id, captureResult.memoryId);
        await userPromptManager.markAsCaptured(prompt.id);
        claimedPromptId = null;
        log("Auto-capture memory persisted", {
          promptId: prompt.id,
          sessionID,
          memoryId: captureResult.memoryId,
          host: host.host,
        });

        if (CONFIG.showAutoCaptureToasts) {
          await notifySafely(host, {
            title: "Memory Captured",
            message: "Project memory saved from conversation",
            variant: "success",
            duration: 3000,
          });
        }
        return;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        await userPromptManager.recordFailedAttempt(prompt.id);

        if (attempt < maxRetries) {
          log(`Auto-capture warning (attempt ${attempt}/${maxRetries})`, { error: errMsg });
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1))
          );
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log(`Auto-capture final error after ${attempt} attempts`, { error: errMsg });

    if (CONFIG.showErrorToasts) {
      const shortReason = errMsg.length > 100 ? errMsg.substring(0, 100) + "..." : errMsg;
      await notifySafely(host, {
        title: "Auto Capture Failed",
        message: shortReason,
        variant: "error",
        duration: 5000,
      });
    }
  } finally {
    if (claimedPromptId !== null) {
      try {
        await userPromptManager.releaseClaim(claimedPromptId);
      } catch (releaseErr) {
        log(
          `Failed to release captured=2 claim for prompt ${claimedPromptId}: ${
            releaseErr instanceof Error ? releaseErr.message : String(releaseErr)
          }`
        );
      }
    }
  }
}
