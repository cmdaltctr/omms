import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { CONFIG, refreshConfigIfChanged } from "../config.js";
import { captureConversation, type CaptureResult, type CaptureWorkUnit } from "../core/capture.js";
import { classifyCaptureFailure, quickRetryDelayMs } from "../core/capture-retry-policy.js";
import type { CaptureSummaryProvider } from "../core/host.js";
import type { ModelPort } from "../core/profile-analysis.js";
import {
  buildRecentMemoriesSection,
  buildRetrievalSection,
  formatMemoriesForCompaction,
  stripRetrievalSections,
  wrapRetrievalSection,
} from "../core/retrieval.js";
import { resolveClaudeCodeLiveModel } from "../services/ai/live-model-choice.js";
import {
  captureFailureOf,
  drainCaptureRetries,
  queueFailedCapture,
  registerCaptureRetryDrain,
  startCaptureRetryDrain,
} from "../services/capture-retry-drain.js";
import {
  readClaudeCaptureCursor,
  writeClaudeCaptureCursor,
} from "../services/claude-capture-cursor.js";
import { memoryClient } from "../services/client.js";
import { log } from "../services/logger.js";
import { isFullyPrivate, stripPrivateContent } from "../services/privacy.js";
import { getTags } from "../services/tags.js";
import {
  extractClaudeWindowsAfter,
  parseClaudeTranscript,
  type ClaudeConversationWindow,
  type ClaudeTranscriptEntry,
} from "./claude-conversation.js";
import { defaultClaudeProjectsRoot } from "./claude-reader.js";

// The web app's side of the Claude Code hooks (design decisions 4, 6, 7):
// retrieval for SessionStart and UserPromptSubmit, a one-worker capture queue
// for Stop, profile learning, and the once-per-process backfill start. Logs
// carry event names, session ids, counts, sizes, and codes; never text.

const HOST = "claude-code";

export interface ClaudeHookDeps {
  /** The capture model. Defaults to the external API. */
  captureProvider?: () => CaptureSummaryProvider;
  /** The profile learning model. Defaults to the external API. */
  profileModel?: () => ModelPort;
  /** Starts the Claude Code backfill after the start-up delay; the web app passes its controls. */
  startBackfill?: () => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
}

/** A hook request the handler cannot use. `status` is the HTTP status. */
export class ClaudeHookRequestError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ClaudeHookRequestError";
  }
}

interface RetrieveRequest {
  event: "session-start" | "user-prompt-submit";
  sessionId: string;
  cwd: string;
  source?: string;
  prompt?: string;
}

interface CaptureRequest {
  sessionId: string;
  cwd: string;
  transcriptPath: string;
  lastAssistantMessage?: string;
  stopHookActive: boolean;
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ClaudeHookRequestError("A JSON object is required");
  }
  return body as Record<string, unknown>;
}

function sessionAndCwd(body: Record<string, unknown>): { sessionId: string; cwd: string } {
  const { session_id: sessionId, cwd } = body;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new ClaudeHookRequestError("session_id is required");
  }
  if (typeof cwd !== "string" || !isAbsolute(cwd)) {
    throw new ClaudeHookRequestError("cwd must be an absolute path");
  }
  return { sessionId, cwd };
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ClaudeHookRequestError(`${key} must be a string`);
  return value;
}

function parseRetrieveRequest(body: unknown): RetrieveRequest {
  const input = objectBody(body);
  if (input.event !== "session-start" && input.event !== "user-prompt-submit") {
    throw new ClaudeHookRequestError("event must be session-start or user-prompt-submit");
  }
  return {
    event: input.event,
    ...sessionAndCwd(input),
    source: optionalString(input, "source"),
    prompt: optionalString(input, "prompt"),
  };
}

/** Resolves symlinks. A path that does not exist yet resolves through its nearest existing parent. */
function realPathOrResolved(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(realPathOrResolved(parent), basename(absolute));
  }
}

/**
 * Claude Code writes `<projects root>/<folder>/<session_id>.jsonl`. Accept only
 * that shape, so the route cannot be used to read other `.jsonl` files. Returns
 * the resolved path, which the capture then reads.
 */
function checkedTranscriptPath(transcriptPath: string, sessionId: string): string {
  const fileName = `${sessionId}.jsonl`;
  const real = realPathOrResolved(transcriptPath);
  if (basename(transcriptPath) !== fileName || basename(real) !== fileName) {
    throw new ClaudeHookRequestError("transcript_path must be named <session_id>.jsonl");
  }
  const root = realPathOrResolved(defaultClaudeProjectsRoot());
  if (!real.startsWith(root + sep)) {
    throw new ClaudeHookRequestError("transcript_path must be under the Claude projects folder");
  }
  return real;
}

function parseCaptureRequest(body: unknown): CaptureRequest {
  const input = objectBody(body);
  const transcriptPath = input.transcript_path;
  if (
    typeof transcriptPath !== "string" ||
    !isAbsolute(transcriptPath) ||
    !transcriptPath.endsWith(".jsonl")
  ) {
    throw new ClaudeHookRequestError("transcript_path must be an absolute .jsonl path");
  }
  const { sessionId, cwd } = sessionAndCwd(input);
  return {
    sessionId,
    cwd,
    transcriptPath: checkedTranscriptPath(transcriptPath, sessionId),
    lastAssistantMessage: optionalString(input, "last_assistant_message"),
    stopHookActive: input.stop_hook_active === true,
  };
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.name : "unknown";
}

// --- Retrieval ---

let backfillRequested = false;

/** The first session start in this process starts the Claude Code backfill, once. */
function maybeStartBackfill(deps: ClaudeHookDeps): void {
  if (backfillRequested || !deps.startBackfill) return;
  if (!CONFIG.autoBackfill || process.env.OMMS_DISABLE_AUTO_BACKFILL === "1") return;
  backfillRequested = true;
  void deps
    .startBackfill()
    .catch((error: unknown) =>
      log("Claude Code backfill start failed", { code: errorCode(error) })
    );
}

async function retrievalSection(request: RetrieveRequest): Promise<string | null> {
  if (request.event === "user-prompt-submit") {
    const prompt = stripPrivateContent(request.prompt ?? "").trim();
    if (!CONFIG.chatMessage.enabled || !prompt || isFullyPrivate(request.prompt ?? "")) {
      return null;
    }
    return buildRetrievalSection(prompt, request.cwd, request.sessionId);
  }

  const tags = getTags(request.cwd);
  if (request.source === "compact" || request.source === "resume") {
    if (!CONFIG.compaction.enabled) return null;
    const result = await memoryClient.searchMemoriesBySessionID(
      request.sessionId,
      tags.project.tag,
      CONFIG.compaction.memoryLimit
    );
    const own = result.success
      ? result.results.filter((memory: any) => memory.metadata?.host === HOST)
      : [];
    return own.length > 0 ? formatMemoriesForCompaction(own) : null;
  }

  if (!CONFIG.chatMessage.enabled) return null;
  return buildRecentMemoriesSection({
    projectTag: tags.project.tag,
    userEmail: tags.user.userEmail,
    sessionId: request.sessionId,
    maxMemories: CONFIG.chatMessage.maxMemories,
    excludeCurrentSession: CONFIG.chatMessage.excludeCurrentSession,
    maxAgeDays: CONFIG.chatMessage.maxAgeDays,
  });
}

/**
 * `POST /api/claude/retrieve`: recent project memories for a fresh session,
 * the session's own memories after compaction or resume, or the retrieval
 * section for a prompt. Every text is wrapped in the retrieval tag; an empty
 * string means nothing to add.
 */
export async function handleClaudeRetrieve(
  body: unknown,
  deps: ClaudeHookDeps = {}
): Promise<{ additionalContext: string }> {
  const request = parseRetrieveRequest(body);
  refreshConfigIfChanged(request.cwd);
  if (request.event === "session-start") maybeStartBackfill(deps);
  try {
    const section = await retrievalSection(request);
    return { additionalContext: section ? wrapRetrievalSection(section) : "" };
  } catch (error) {
    log("Claude Code retrieval failed", {
      event: request.event,
      sessionID: request.sessionId,
      code: errorCode(error),
    });
    return { additionalContext: "" };
  }
}

// --- Capture ---

let captureChain: Promise<void> = Promise.resolve();
let captureOffReported = false;

/** Log once per process that capture is off and which settings are missing. */
function reportCaptureOff(issues: string[]): void {
  if (captureOffReported) return;
  captureOffReported = true;
  log("Claude Code capture is off", { issues });
}

/**
 * `POST /api/claude/capture`: check the request, queue the turn on the
 * one-worker queue, and answer at once. Throws `ClaudeHookRequestError` for a
 * request that cannot be used.
 */
export function handleClaudeCapture(body: unknown, deps: ClaudeHookDeps = {}): { queued: true } {
  const request = parseCaptureRequest(body);
  captureChain = captureChain
    .then(() => captureTurn(request, deps))
    .catch((error: unknown) =>
      log("Claude Code capture failed", { sessionID: request.sessionId, code: errorCode(error) })
    );
  return { queued: true };
}

/** Resolves when every queued capture has finished. */
export function whenClaudeCaptureIdle(): Promise<void> {
  return captureChain;
}

function skipped(request: CaptureRequest, code: string, data: Record<string, unknown> = {}): void {
  log("Claude Code capture skipped", { sessionID: request.sessionId, code, ...data });
}

async function readTranscript(request: CaptureRequest): Promise<ClaudeTranscriptEntry[] | null> {
  let text: string;
  try {
    text = await readFile(request.transcriptPath, "utf8");
  } catch (error) {
    const code = errorCode(error);
    skipped(request, code === "ENOENT" ? "transcript-missing" : "transcript-unreadable", {
      error: code,
    });
    return null;
  }
  const parsed = parseClaudeTranscript(text);
  if (parsed.entries.length === 0) {
    skipped(request, "transcript-unreadable", {
      bytes: Buffer.byteLength(text),
      unreadableLines: parsed.unreadableLines,
      unknownTypes: parsed.unknownTypes,
    });
    return null;
  }
  return parsed.entries;
}

/**
 * The windows after the cursor. The transcript file can lag the hook, so the
 * hook's final text is added as a last assistant reply when the transcript
 * does not already end with it. It carries no entry id, so `sourceEntryIds`
 * stay the reader's ids.
 */
export function claudeWindowsToCapture(
  entries: ClaudeTranscriptEntry[],
  cursor: string | null,
  finalText: string | undefined
): ClaudeConversationWindow[] {
  const tail = finalText?.trim();
  if (!tail) return extractClaudeWindowsAfter(entries, cursor);
  const hookReply: ClaudeTranscriptEntry = {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: tail }] },
  };
  const windows = extractClaudeWindowsAfter([...entries, hookReply], cursor);
  const last = windows.at(-1);
  const replies = last?.textResponses ?? [];
  if (replies.length > 1 && replies[replies.length - 2]!.trim().endsWith(tail)) replies.pop();
  return windows;
}

/**
 * The project a session belongs to: the first prompt's directory, the same rule
 * the history import uses. Live capture must file a turn under the project the
 * import would choose, or the import cannot see that the turn is already saved.
 */
function sessionDirectory(entries: ClaudeTranscriptEntry[], fallback: string): string {
  const first = entries.find((entry) => entry.type === "user" && entry.isSidechain !== true);
  return typeof first?.cwd === "string" && first.cwd ? first.cwd : fallback;
}

/** A cleaned work unit, or null for a prompt with nothing left to capture. */
function workUnitOf(
  request: CaptureRequest,
  window: ClaudeConversationWindow,
  directory: string
): CaptureWorkUnit | null {
  const prompt = stripRetrievalSections(window.userPrompt);
  if (!prompt || isFullyPrivate(prompt)) return null;
  return {
    host: HOST,
    hostSessionId: request.sessionId,
    sourceType: "live-capture",
    projectDirectory: directory,
    userPrompt: stripPrivateContent(prompt),
    promptId: window.userEntryId,
    textResponses: window.textResponses.map(stripPrivateContent),
    toolCalls: window.toolCalls.map((call) => ({
      name: call.name,
      input: stripPrivateContent(call.input),
    })),
    sourceEntryIds: window.sourceEntryIds,
    ...(window.sourceTimestamp !== undefined ? { sourceTimestamp: window.sourceTimestamp } : {}),
  };
}

/** Try the turn up to `autoCaptureMaxRetries` times, as the other hosts do. */
async function captureWithQuickRetries(
  unit: CaptureWorkUnit,
  provider: CaptureSummaryProvider,
  sleep: (ms: number) => Promise<void>
): Promise<CaptureResult> {
  const maxRetries = Math.max(1, CONFIG.autoCaptureMaxRetries ?? 3);
  for (let attempt = 1; ; attempt++) {
    try {
      return await captureConversation(unit, provider);
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      await sleep(quickRetryDelayMs(attempt));
    }
  }
}

async function externalModels(): Promise<{ capture: CaptureSummaryProvider; profile: ModelPort }> {
  const { selectImportModel } = await import("./model-selection.js");
  return selectImportModel({});
}

async function captureTurn(request: CaptureRequest, deps: ClaudeHookDeps): Promise<void> {
  const started = Date.now();
  refreshConfigIfChanged(request.cwd);
  if (!CONFIG.autoCaptureEnabled) return;
  const live = resolveClaudeCodeLiveModel(CONFIG);
  if (!live.ready) return reportCaptureOff(live.issues);
  if (memoryClient.getEmbeddingInitError?.()) return skipped(request, "not-ready");

  const entries = await readTranscript(request);
  if (!entries) return;
  const cursor = await readClaudeCaptureCursor(request.sessionId, CONFIG);
  const windows = claudeWindowsToCapture(entries, cursor, request.lastAssistantMessage);
  if (windows.length === 0) {
    // A repeated Stop is the case the flag exists for, so record it even with nothing to capture.
    if (request.stopHookActive)
      log("Claude Code capture idle", { sessionID: request.sessionId, stopHookActive: true });
    return;
  }
  const directory = sessionDirectory(entries, request.cwd);

  let provider: CaptureSummaryProvider;
  try {
    provider = deps.captureProvider?.() ?? (await externalModels()).capture;
  } catch (error) {
    return skipped(request, "model-unavailable", { error: errorCode(error) });
  }

  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const counts = { captured: 0, skipped: 0, failed: 0, private: 0, queued: 0 };
  let blocked: unknown = null;
  for (const window of windows) {
    const unit = workUnitOf(request, window, directory);
    if (!unit) {
      counts.private++;
    } else if (blocked) {
      // The model is out of reach: queue the rest of the turns without calling it.
      if (await queueFailedCapture(unit, blocked, CONFIG)) counts.queued++;
    } else {
      try {
        const result = await captureWithQuickRetries(unit, provider, sleep);
        counts[result.status]++;
        await recordPrompt(request, unit, result.status === "captured" ? result.memoryId : null);
      } catch (error) {
        counts.failed++;
        if (await queueFailedCapture(unit, error, CONFIG)) counts.queued++;
        if (classifyCaptureFailure(captureFailureOf(error)) === "retryable") blocked = error;
      }
    }
    await writeClaudeCaptureCursor(request.sessionId, window.userEntryId, CONFIG);
  }

  log("Claude Code capture finished", {
    sessionID: request.sessionId,
    windows: windows.length,
    ...counts,
    stopHookActive: request.stopHookActive,
    elapsedMs: Date.now() - started,
  });
  if (counts.captured > 0) {
    // The model answers again, so earlier failed turns may go through now.
    startCaptureRetryDrain(HOST);
  }
  if (counts.captured + counts.skipped > 0) await learnProfile(request.cwd, deps);
}

// --- Profile learning ---

async function recordPrompt(
  request: CaptureRequest,
  unit: CaptureWorkUnit,
  memoryId: string | null
): Promise<void> {
  try {
    const { userPromptManager } = await import("../services/user-prompt/user-prompt-manager.js");
    const id = await userPromptManager.savePrompt(
      request.sessionId,
      unit.promptId!,
      request.cwd,
      unit.userPrompt
    );
    await userPromptManager.markAsCaptured(id);
    if (memoryId) await userPromptManager.linkMemoryToPrompt(id, memoryId);
  } catch (error) {
    log("Claude Code prompt record failed", {
      sessionID: request.sessionId,
      code: errorCode(error),
    });
  }
}

let learning = false;

/**
 * Build or update the user profile from the recorded prompts once there are
 * `userProfileAnalysisInterval` of them. A failure is logged and never
 * blocks capture; the prompts stay for the next pass.
 */
async function learnProfile(directory: string, deps: ClaudeHookDeps): Promise<void> {
  const interval = CONFIG.userProfileAnalysisInterval ?? 0;
  if (!(interval > 0) || learning) return;
  learning = true;
  try {
    const [{ userPromptManager }, { userProfileManager }, { analyzeProfile }] = await Promise.all([
      import("../services/user-prompt/user-prompt-manager.js"),
      import("../services/user-profile/user-profile-manager.js"),
      import("../core/profile-analysis.js"),
    ]);
    if ((await userPromptManager.countUnanalyzedForUserLearning()) < interval) return;
    const user = getTags(directory).user;
    if (!user.userEmail) {
      log("Claude Code profile learning skipped", { code: "no-user-email" });
      return;
    }
    const batch = await userPromptManager.getPromptsForUserLearning(interval);
    if (batch.length === 0) return;
    const model = deps.profileModel?.() ?? (await externalModels()).profile;
    const existing = await userProfileManager.getActiveProfile(user.userEmail);
    const context = batch.map((prompt, index) => `${index + 1}. ${prompt.content}`).join("\n");
    const analysis = await analyzeProfile(
      model,
      context,
      existing ? { id: existing.id, profileData: existing.profileData } : null
    );
    if (existing) {
      const updated =
        analysis.merged &&
        (await userProfileManager.updateProfile(
          existing.id,
          analysis.merged,
          batch.length,
          `Claude Code analysis of ${batch.length} prompts`
        ));
      if (!updated) throw new Error("Profile update conflict");
    } else {
      await userProfileManager.createProfile(
        user.userEmail,
        user.displayName || user.userEmail,
        user.userName || user.userEmail,
        user.userEmail,
        analysis.raw,
        batch.length
      );
    }
    await userPromptManager.markMultipleAsUserLearningCaptured(batch.map((prompt) => prompt.id));
    log("Claude Code profile learning finished", {
      prompts: batch.length,
      hadExisting: Boolean(existing),
    });
  } catch (error) {
    log("Claude Code profile learning failed", { code: errorCode(error) });
  } finally {
    learning = false;
  }
}

// --- Web app start ---

/**
 * Register the Claude Code retry drain in this web app and start one retry
 * pass. The drain uses the external API. When capture is off, the first
 * capture request logs the missing settings, so a web app that never serves
 * Claude Code does not log them.
 */
export function startClaudeCodeWorker(): void {
  registerCaptureRetryDrain(HOST, async () => {
    let provider: CaptureSummaryProvider | null = null;
    if (resolveClaudeCodeLiveModel(CONFIG).ready) {
      provider = await externalModels()
        .then((models) => models.capture)
        .catch(() => null);
    }
    return drainCaptureRetries({
      host: HOST,
      // Never called while isReady is false.
      provider: provider ?? {
        summarize: () => Promise.reject(new Error("Claude Code capture model unavailable")),
      },
      config: CONFIG,
      isReady: () => provider !== null && !memoryClient.getEmbeddingInitError?.(),
    });
  });
  if (resolveClaudeCodeLiveModel(CONFIG).ready && CONFIG.autoCaptureEnabled) {
    startCaptureRetryDrain(HOST);
  }
}
