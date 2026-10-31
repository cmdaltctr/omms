import { CONFIG } from "../../config.js";
import type { CaptureWorkUnit } from "../../core/capture.js";
import { quickRetryDelayMs } from "../../core/capture-retry-policy.js";
import type { CaptureSummaryProvider } from "../../core/host.js";
import { handleFinishedTurn } from "../../core/turn-outputs.js";
import { log } from "../../services/logger.js";
import { memoryClient } from "../../services/client.js";
import { queueFailedCapture, startCaptureRetryDrain } from "../../services/capture-retry-drain.js";
import {
  skillTurnRecorder,
  type SkillTurnRecorder,
} from "../../services/skill-learning/settings-for.js";
import {
  extractPiConversation,
  type PiConversationWindow,
  type PiSessionEntry,
} from "../../importer/pi-conversation.js";

export interface PiCaptureState {
  /** User entry IDs terminally handled by a settled capture for this session. */
  handledUserEntries: Set<string>;
  running: boolean;
}

export function createPiCaptureState(): PiCaptureState {
  return { handledUserEntries: new Set(), running: false };
}

export interface PiSettledCaptureInput {
  sessionId: string;
  directory: string;
  entries: PiSessionEntry[];
  provider: CaptureSummaryProvider;
  state: PiCaptureState;
  prompt?: { providerId?: string | null; modelId?: string | null };
  notify?: (notification: {
    title: string;
    message: string;
    variant: "success" | "warning" | "error" | "info";
  }) => Promise<void> | void;
}

export type PiSettledCaptureResult =
  | { status: "captured"; memoryId: string }
  | {
      status: "skipped";
      reason:
        "disabled" | "busy" | "not-ready" | "no-window" | "already-handled" | "extractor-skip";
    }
  | { status: "failed"; error: string };

/** Try the turn up to `autoCaptureMaxRetries` times, as OpenCode does, before it counts as failed. */
async function captureWithQuickRetries(
  unit: CaptureWorkUnit,
  provider: CaptureSummaryProvider,
  recorder: SkillTurnRecorder | undefined
) {
  const maxRetries = Math.max(1, CONFIG.autoCaptureMaxRetries ?? 3);
  for (let attempt = 1; ; attempt++) {
    try {
      // A repeated attempt records the same turn key, which the store drops.
      return await handleFinishedTurn(
        unit,
        { memories: true, skills: recorder !== undefined },
        { provider, recordSkillTurn: recorder }
      );
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      log(
        `Pi auto-capture warning (attempt ${attempt}/${maxRetries})`,
        {
          sessionID: unit.hostSessionId,
        },
        "warn"
      );
      await new Promise((resolve) => setTimeout(resolve, quickRetryDelayMs(attempt)));
    }
  }
}

function piWorkUnit(input: PiSettledCaptureInput, window: PiConversationWindow): CaptureWorkUnit {
  return {
    host: "pi",
    hostSessionId: input.sessionId,
    sourceType: "live-capture",
    projectDirectory: input.directory,
    userPrompt: window.userPrompt,
    promptId: window.userEntryId,
    prompt: {
      id: window.userEntryId,
      providerId: input.prompt?.providerId ?? null,
      modelId: input.prompt?.modelId ?? null,
    },
    textResponses: window.textResponses,
    toolCalls: window.toolCalls,
    sourceEntryIds: window.sourceEntryIds,
    ...(window.sourceTimestamp !== undefined ? { sourceTimestamp: window.sourceTimestamp } : {}),
  };
}

/** Memory capture is off or not ready: record the settled turn for skill learning only. */
async function recordSkillTurnOnly(
  input: PiSettledCaptureInput,
  window: PiConversationWindow | null = extractPiConversation(input.entries)
): Promise<void> {
  const recorder = skillTurnRecorder(input.directory);
  if (!recorder || !window) return;
  await handleFinishedTurn(
    piWorkUnit(input, window),
    { memories: false, skills: true },
    { recordSkillTurn: recorder }
  );
}

/**
 * Capture the work unit completed by the most recent user prompt on the
 * settled branch. Safe to call for every `agent_settled` event: a work unit is
 * processed at most once per user entry ID (live source identity), so retries,
 * compaction continuation, and repeated settled events never double-capture.
 */
export async function capturePiSettledWorkUnit(
  input: PiSettledCaptureInput
): Promise<PiSettledCaptureResult> {
  if (!CONFIG.autoCaptureEnabled) {
    // Skill learning records turns even when memory capture is off (ADR-035).
    await recordSkillTurnOnly(input);
    return { status: "skipped", reason: "disabled" };
  }
  if (input.state.running) return { status: "skipped", reason: "busy" };
  input.state.running = true;
  let workUnit: CaptureWorkUnit | null = null;

  try {
    const window = extractPiConversation(input.entries);
    if (!window) return { status: "skipped", reason: "no-window" };

    if (input.state.handledUserEntries.has(window.userEntryId)) {
      return { status: "skipped", reason: "already-handled" };
    }

    const embeddingInitError = memoryClient.getEmbeddingInitError?.();
    if (embeddingInitError) {
      await recordSkillTurnOnly(input, window);
      return { status: "skipped", reason: "not-ready" };
    }

    workUnit = piWorkUnit(input, window);
    const captureResult = await captureWithQuickRetries(
      workUnit,
      input.provider,
      skillTurnRecorder(input.directory)
    );

    input.state.handledUserEntries.add(window.userEntryId);

    if (captureResult.status === "skipped") {
      log("Pi auto-capture skipped by extractor", {
        sessionID: input.sessionId,
        userEntryId: window.userEntryId,
        type: captureResult.type,
      });
      return { status: "skipped", reason: "extractor-skip" };
    }

    log("Pi auto-capture memory persisted", {
      sessionID: input.sessionId,
      userEntryId: window.userEntryId,
      memoryId: captureResult.memoryId,
      host: "pi",
    });
    // The capture model answers again, so earlier failed turns may go through now.
    startCaptureRetryDrain("pi");

    if (CONFIG.showAutoCaptureToasts && input.notify) {
      await Promise.resolve(
        input.notify({
          title: "Memory Captured",
          message: "Project memory saved from conversation",
          variant: "success",
        })
      ).catch(() => {});
    }

    return { status: "captured", memoryId: captureResult.memoryId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Pi auto-capture error: ${message}`, { sessionID: input.sessionId }, "error");
    // The next prompt moves capture on to a newer turn, so keep this one for a later retry.
    if (workUnit) await queueFailedCapture(workUnit, error, CONFIG);

    if (CONFIG.showErrorToasts && input.notify) {
      const shortReason = message.length > 100 ? message.substring(0, 100) + "..." : message;
      await Promise.resolve(
        input.notify({
          title: "Auto Capture Failed",
          message: shortReason,
          variant: "error",
        })
      ).catch(() => {});
    }
    return { status: "failed", error: message };
  } finally {
    input.state.running = false;
  }
}
