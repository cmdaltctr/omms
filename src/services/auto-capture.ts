import { CONFIG, refreshConfigIfChanged } from "../config.js";
import type { CaptureResult, CaptureWorkUnit } from "../core/capture.js";
import { quickRetryDelayMs } from "../core/capture-retry-policy.js";
import type { AutoCaptureHost, CaptureConversation } from "../core/host.js";
import { handleFinishedTurn } from "../core/turn-outputs.js";
import {
  drainCaptureRetries,
  queueFailedCapture,
  startCaptureRetryDrain,
  type CaptureRetryDrainResult,
} from "./capture-retry-drain.js";
import { log } from "./logger.js";
import { skillTurnRecorder, type SkillTurnRecorder } from "./skill-learning/settings-for.js";
import { userPromptManager, type UserPrompt } from "./user-prompt/user-prompt-manager.js";

export {
  buildBoundedSummaryPrompt,
  buildMarkdownContext,
  getAutoCaptureMarkdownBudget,
} from "../core/capture-context.js";

let isCaptureRunning = false;

/**
 * With memory capture off, prompts stay uncaptured, so each idle event lists
 * them again. This keeps, per session, the time of the last prompt recorded for
 * skill learning, so no conversation is read twice. The prompts are not marked
 * captured, so memory capture still sees them once it is turned on.
 */
const skillRecordedUpTo = new Map<string, number>();

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
    if (prompts.length === 0) return;
    const recorder = skillTurnRecorder(directory);
    // Skill learning records turns even when memory capture is off (ADR-036).
    if (CONFIG.autoCaptureEnabled === false || !host.isCaptureReady()) {
      for (const prompt of prompts) {
        if (prompt.createdAt <= (skillRecordedUpTo.get(sessionID) ?? -Infinity)) continue;
        if (await recordSkillTurnOnly(host, sessionID, directory, prompt, recorder))
          skillRecordedUpTo.set(sessionID, prompt.createdAt);
      }
      return;
    }

    const maxRetries = CONFIG.autoCaptureMaxRetries ?? 3;
    for (const prompt of prompts) {
      await capturePrompt(host, sessionID, directory, prompt, maxRetries, recorder);
    }
  } finally {
    isCaptureRunning = false;
  }
}

function opencodeWorkUnit(
  host: AutoCaptureHost,
  sessionID: string,
  directory: string,
  prompt: UserPrompt,
  conversation: CaptureConversation
): CaptureWorkUnit {
  return {
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
  };
}

/**
 * The skill output keys a turn by OpenCode's message id, the id the history
 * import reads, so a live turn imported later stays one row. The memory unit
 * keeps the OMMS prompt id.
 */
function opencodeSkillRecorder(prompt: UserPrompt, recorder: SkillTurnRecorder | undefined) {
  return recorder && ((unit: CaptureWorkUnit) => recorder({ ...unit, promptId: prompt.messageId }));
}

/**
 * Memory capture is off or not ready: record the turn for skill learning only.
 * Returns true when the finished turn went to the skill output.
 */
async function recordSkillTurnOnly(
  host: AutoCaptureHost,
  sessionID: string,
  directory: string,
  prompt: UserPrompt,
  recorder: SkillTurnRecorder | undefined
): Promise<boolean> {
  if (!recorder) return false;
  try {
    const conversation = await host.getConversation(sessionID, prompt.messageId);
    if (!conversation) return false;
    if (conversation.textResponses.length === 0 && conversation.toolCalls.length === 0)
      return false;
    await handleFinishedTurn(
      opencodeWorkUnit(host, sessionID, directory, prompt, conversation),
      { memories: false, skills: true },
      { recordSkillTurn: opencodeSkillRecorder(prompt, recorder) }
    );
    return true;
  } catch {
    log("OpenCode skill turn read failed", { sessionID, code: "conversation-read-failed" }, "warn");
    return false;
  }
}

async function capturePrompt(
  host: AutoCaptureHost,
  sessionID: string,
  directory: string,
  prompt: UserPrompt,
  maxRetries: number,
  recorder: SkillTurnRecorder | undefined
): Promise<void> {
  let claimedPromptId: string | null = null;
  let attempt = prompt.capture_attempts || 0;
  let workUnit: CaptureWorkUnit | null = null;

  try {
    if (!(await userPromptManager.claimPrompt(prompt.id))) return;
    claimedPromptId = prompt.id;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const conversation = await host.getConversation(sessionID, prompt.messageId);
        if (!conversation) return;
        if (conversation.textResponses.length === 0 && conversation.toolCalls.length === 0) return;

        workUnit = opencodeWorkUnit(host, sessionID, directory, prompt, conversation);
        const record = opencodeSkillRecorder(prompt, recorder);
        const captureResult = await handleFinishedTurn(
          workUnit,
          { memories: true, skills: record !== undefined },
          { provider: host, recordSkillTurn: record }
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
        // The capture model answers again, so earlier failed turns may go through now.
        startCaptureRetryDrain("opencode");

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
          log(`Auto-capture warning (attempt ${attempt}/${maxRetries})`, { error: errMsg }, "warn");
          await new Promise((resolve) => setTimeout(resolve, quickRetryDelayMs(attempt)));
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log(`Auto-capture final error after ${attempt} attempts`, { error: errMsg }, "error");
    // Only after the quick retries fail; the queue decides whether a retry can help.
    if (workUnit) await queueFailedCapture(workUnit, error, CONFIG);

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
          }`,
          undefined,
          "error"
        );
      }
    }
  }
}

/** A retried OpenCode turn updates its prompt row the same way a live capture does. */
export async function settleOpencodeRetriedPrompt(
  unit: CaptureWorkUnit,
  result: CaptureResult
): Promise<void> {
  if (!unit.promptId) return;
  if (result.status === "skipped") {
    await userPromptManager.deletePrompt(unit.promptId);
    return;
  }
  await userPromptManager.linkMemoryToPrompt(unit.promptId, result.memoryId);
  await userPromptManager.markAsCaptured(unit.promptId);
}

/** Retry OpenCode's queued turns with its current capture model choice. */
export function drainOpencodeCaptureRetries(
  host: AutoCaptureHost,
  directory: string
): Promise<CaptureRetryDrainResult> {
  // A retention change in the config file applies from this pass on.
  refreshConfigIfChanged(directory);
  return drainCaptureRetries({
    host: "opencode",
    provider: host,
    config: CONFIG,
    isReady: () => host.isCaptureReady(),
    onSettled: settleOpencodeRetriedPrompt,
  });
}
