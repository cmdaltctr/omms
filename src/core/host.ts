import type { MemoryHost, MemorySourceType } from "../types/index.js";

export type CaptureToolOutcome = "ok" | "error" | "unknown";

/**
 * Set only on a `memory` tool call in `memorise` mode: `saved` once its result
 * reported success, `failed` when it did not, `unknown` until a result answers.
 * Automatic capture skips a turn that holds a `saved` call.
 */
export type CaptureMemoriseState = "saved" | "failed" | "unknown";

export interface CaptureToolCall {
  name: string;
  input: string;
  /** Set by the host readers for skill learning. Memory capture ignores it. */
  outcome?: CaptureToolOutcome;
  /** Error text the host reported, at most 2,000 characters. Memory capture ignores it. */
  error?: string;
  /** Full path of a read-type call, for skill detection. Memory capture ignores it. */
  path?: string;
  /** Set by the host readers on a memorise call. Capture skips the turn when it is `saved`. */
  memorise?: CaptureMemoriseState;
}

export interface CaptureConversation {
  textResponses: string[];
  toolCalls: CaptureToolCall[];
  sourceEntryIds?: string[];
  sourceTimestamp?: number;
}

export interface CapturePromptContext {
  id?: string;
  providerId?: string | null;
  modelId?: string | null;
}

export interface CaptureSummary {
  summary: string;
  type: string;
  tags: string[];
}

export type CaptureAttemptOutcome = "saved" | "skipped" | "failed";

/** Fixed failure codes, in the order classification checks them. */
export const CAPTURE_FAILURE_REASONS = [
  "call-error",
  "empty-text",
  "truncated",
  "invalid-json",
  "schema-mismatch",
  "persist-error",
] as const;

export type CaptureFailureReason = (typeof CAPTURE_FAILURE_REASONS)[number];

/** Why capture ended a turn as skipped before the capture model ran. */
export type CaptureSkipReason = "memorisation-turn";

export type CaptureExtractionPath = "host-model" | "external-api";

/**
 * Filled in by the extraction path during one capture attempt. The capture
 * pipeline owns the object and emits it once the outcome is known. Fields a
 * path cannot observe stay undefined. The prompt and reply fields are only
 * ever written to the opt-in trace file, never to the log.
 */
export interface CaptureAttemptDiagnostics {
  path?: CaptureExtractionPath;
  provider?: string;
  model?: string;
  stopReason?: string;
  blockTypes?: string[];
  systemPrompt?: string;
  userPrompt?: string;
  rawReply?: string;
  failureReason?: CaptureFailureReason;
  /** Set when capture skipped the turn without calling the capture model. */
  skipReason?: CaptureSkipReason;
  /** HTTP status of a failed model call, when the path knows it. */
  httpStatus?: number;
  /** The wait a failed model call asked for in its `Retry-After` header. */
  retryAfterMs?: number;
}

export interface CaptureSummaryRequest {
  context: string;
  sessionId: string;
  projectDirectory: string;
  userPrompt: string;
  prompt?: CapturePromptContext;
  diagnostics?: CaptureAttemptDiagnostics;
}

export interface CaptureSummaryProvider {
  summarize(request: CaptureSummaryRequest): Promise<CaptureSummary | null>;
}

export interface AutoCaptureNotification {
  title: string;
  message: string;
  variant: "success" | "warning" | "error" | "info";
  duration: number;
}

export interface AutoCaptureHost extends CaptureSummaryProvider {
  readonly host: MemoryHost;
  isCaptureReady(): boolean;
  getConversation(sessionId: string, promptMessageId: string): Promise<CaptureConversation | null>;
  notify?(notification: AutoCaptureNotification): Promise<void> | void;
}

export interface CaptureProvenance {
  host: MemoryHost;
  hostSessionId: string;
  sourceType: MemorySourceType;
  sourceEntryIds?: string[];
  sourceTimestamp?: number;
  sourceFile?: string;
  importId?: string;
}
