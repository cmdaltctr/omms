import { CONFIG, refreshConfigIfChanged } from "../config.js";
import { buildCaptureAttemptRecord, emitCaptureAttempt } from "../services/capture-diagnostics.js";
import { memoryClient } from "../services/client.js";
import { getTags } from "../services/tags.js";
import { buildMarkdownContext, getAutoCaptureMarkdownBudget } from "./capture-context.js";
import {
  errorHttpStatus,
  errorRetryAfterMs,
  type CaptureFailureInfo,
} from "./capture-retry-policy.js";
import type {
  CaptureAttemptDiagnostics,
  CaptureAttemptOutcome,
  CaptureConversation,
  CapturePromptContext,
  CaptureProvenance,
  CaptureSummaryProvider,
} from "./host.js";

export interface CaptureWorkUnit extends CaptureProvenance, CaptureConversation {
  projectDirectory: string;
  userPrompt: string;
  promptId?: string;
  prompt?: CapturePromptContext;
}

export type CaptureResult =
  { status: "captured"; memoryId: string } | { status: "skipped"; type?: string };

/**
 * Thrown by `captureConversation` for a failed attempt. Keeps the original
 * message and cause, and adds what the retry queue needs to classify it.
 */
export class CaptureAttemptError extends Error {
  readonly failure: CaptureFailureInfo;

  constructor(error: unknown, failure: CaptureFailureInfo) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = "CaptureAttemptError";
    this.failure = failure;
  }
}

async function getLatestProjectMemory(containerTag: string): Promise<string | null> {
  try {
    const result = await memoryClient.listMemories(containerTag, 1);
    if (!result.success || result.memories.length === 0) return null;

    const latest = result.memories[0];
    if (!latest) return null;

    return latest.summary.length <= 500 ? latest.summary : latest.summary.substring(0, 500) + "...";
  } catch {
    return null;
  }
}

/**
 * Run one capture attempt and write exactly one diagnostics record for it,
 * whether it is saved, skipped, or fails.
 */
export async function captureConversation(
  workUnit: CaptureWorkUnit,
  provider: CaptureSummaryProvider
): Promise<CaptureResult> {
  refreshConfigIfChanged(workUnit.projectDirectory);
  // Snapshot the markdown budget after the refresh and before the first
  // await: a config edit during the memory read must not change this
  // capture's input limit. The budget keeps its built-in request reserve.
  const markdownBudget = getAutoCaptureMarkdownBudget();
  const diagnostics: CaptureAttemptDiagnostics = {};
  const startedAt = Date.now();
  let outcome: CaptureAttemptOutcome = "failed";
  try {
    const result = await runCapture(workUnit, provider, diagnostics, markdownBudget);
    outcome = result.status === "captured" ? "saved" : "skipped";
    return result;
  } catch (error) {
    throw new CaptureAttemptError(error, {
      reason: diagnostics.failureReason ?? "call-error",
      httpStatus: diagnostics.httpStatus ?? errorHttpStatus(error),
      retryAfterMs: diagnostics.retryAfterMs ?? errorRetryAfterMs(error),
    });
  } finally {
    const record = buildCaptureAttemptRecord(
      {
        host: workUnit.host,
        sourceType: workUnit.sourceType,
        sessionId: workUnit.hostSessionId,
      },
      diagnostics,
      outcome,
      Date.now() - startedAt
    );
    emitCaptureAttempt(record, diagnostics, CONFIG);
  }
}

async function runCapture(
  workUnit: CaptureWorkUnit,
  provider: CaptureSummaryProvider,
  diagnostics: CaptureAttemptDiagnostics,
  markdownBudget: number
): Promise<CaptureResult> {
  const tags = getTags(workUnit.projectDirectory);
  const latestMemory = await getLatestProjectMemory(tags.project.tag);
  const context = buildMarkdownContext(
    workUnit.userPrompt,
    workUnit.textResponses,
    workUnit.toolCalls,
    latestMemory,
    markdownBudget
  );

  let summaryResult;
  try {
    summaryResult = await provider.summarize({
      context,
      sessionId: workUnit.hostSessionId,
      projectDirectory: workUnit.projectDirectory,
      userPrompt: workUnit.userPrompt,
      prompt: workUnit.prompt,
      diagnostics,
    });
  } catch (error) {
    diagnostics.failureReason ??= "call-error";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Summary generation failed: ${message}`, { cause: error });
  }

  if (!summaryResult || summaryResult.type === "skip") {
    return { status: "skipped", type: summaryResult?.type };
  }

  const summaryWithTags =
    summaryResult.tags.length > 0
      ? `${summaryResult.summary}\n\nTags: ${summaryResult.tags.join(", ")}`
      : summaryResult.summary;

  const source = workUnit.sourceType === "history-import" ? "import" : "auto-capture";
  // Anything that goes wrong from here on is a storage failure, thrown or reported.
  diagnostics.failureReason = "persist-error";
  const result = await memoryClient.addMemory(summaryWithTags, tags.project.tag, {
    source,
    type: summaryResult.type,
    tags: summaryResult.tags,
    sessionID: workUnit.hostSessionId,
    promptId: workUnit.promptId,
    captureTimestamp: Date.now(),
    host: workUnit.host,
    hostSessionId: workUnit.hostSessionId,
    sourceType: workUnit.sourceType,
    sourceEntryIds: workUnit.sourceEntryIds,
    sourceTimestamp: workUnit.sourceTimestamp,
    sourceFile: workUnit.sourceFile,
    importId: workUnit.importId,
    displayName: tags.project.displayName,
    userName: tags.project.userName,
    userEmail: tags.project.userEmail,
    projectPath: tags.project.projectPath,
    projectName: tags.project.projectName,
    gitRepoUrl: tags.project.gitRepoUrl,
  });

  if (!result.success) {
    throw new Error(`Memory persistence failed: ${result.error || "database write failed"}`);
  }

  diagnostics.failureReason = undefined;
  return { status: "captured", memoryId: result.id };
}
