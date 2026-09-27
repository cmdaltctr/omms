import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import type {
  CaptureAttemptDiagnostics,
  CaptureAttemptOutcome,
  CaptureExtractionPath,
  CaptureFailureReason,
} from "../core/host.js";
import type { MemoryHost, MemorySourceType } from "../types/index.js";
import { getLogDirPath } from "./log-path.js";
import { log } from "./logger.js";
import { stripPrivateContent } from "./privacy.js";

/**
 * The config fields this module reads. Callers pass `CONFIG`; tests pass a
 * plain object, so no import of `../config.js` is needed here.
 */
export interface CaptureDiagnosticsConfig {
  captureTrace?: boolean;
  captureTraceRetentionDays?: number;
  memoryApiKey?: string;
  embeddingApiKey?: string;
  webServerApiToken?: string;
  webServerAuthPassword?: string;
}

export interface CaptureAttemptContext {
  host: MemoryHost;
  sourceType: MemorySourceType;
  sessionId: string;
}

/**
 * The metadata-only record written to the OMMS log for every attempt. Every
 * key is always present so records from both hosts have one shape; a value a
 * path could not observe is null.
 */
export interface CaptureAttemptRecord {
  host: MemoryHost;
  sourceType: MemorySourceType;
  sessionId: string;
  path: CaptureExtractionPath | null;
  provider: string | null;
  model: string | null;
  stopReason: string | null;
  blockTypes: string[] | null;
  promptChars: number | null;
  replyChars: number | null;
  durationMs: number;
  outcome: CaptureAttemptOutcome;
  reason: CaptureFailureReason | null;
}

export const DEFAULT_CAPTURE_TRACE_RETENTION_DAYS = 7;
const TRACE_SCHEMA_VERSION = 1;
const TRACE_FILE = /^capture-(\d{4})-(\d{2})-(\d{2})\.jsonl$/;
const REDACTED = "[REDACTED]";

export function buildCaptureAttemptRecord(
  context: CaptureAttemptContext,
  diagnostics: CaptureAttemptDiagnostics,
  outcome: CaptureAttemptOutcome,
  durationMs: number
): CaptureAttemptRecord {
  const promptChars =
    diagnostics.systemPrompt === undefined && diagnostics.userPrompt === undefined
      ? null
      : (diagnostics.systemPrompt?.length ?? 0) + (diagnostics.userPrompt?.length ?? 0);
  return {
    host: context.host,
    sourceType: context.sourceType,
    sessionId: context.sessionId,
    path: diagnostics.path ?? null,
    provider: diagnostics.provider ?? null,
    model: diagnostics.model ?? null,
    stopReason: diagnostics.stopReason ?? null,
    blockTypes: diagnostics.blockTypes ?? null,
    promptChars,
    replyChars: diagnostics.rawReply?.length ?? null,
    durationMs,
    outcome,
    reason: outcome === "failed" ? (diagnostics.failureReason ?? "call-error") : null,
  };
}

// Common key and token formats. Each match is replaced whole, except the
// Bearer rule, which keeps the scheme so the trace still reads naturally.
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, REDACTED],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${REDACTED}`],
];

function configuredSecrets(config: CaptureDiagnosticsConfig): string[] {
  return [
    config.memoryApiKey,
    config.embeddingApiKey,
    config.webServerApiToken,
    config.webServerAuthPassword,
  ].filter(
    (value): value is string =>
      typeof value === "string" &&
      // Short values would redact ordinary words; unresolved references are not secrets.
      value.length >= 8 &&
      !value.startsWith("env://") &&
      !value.startsWith("file://")
  );
}

/**
 * Prepare prompt or reply text for the trace file: drop `<private>` regions the
 * same way memory storage does, then configured secrets, then common key and
 * token formats.
 */
export function redactTraceText(text: string, config: CaptureDiagnosticsConfig): string {
  let result = stripPrivateContent(text);
  for (const secret of configuredSecrets(config)) {
    result = result.replaceAll(secret, REDACTED);
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getTraceDirectory(): string {
  return join(getLogDirPath(), "traces");
}

function retentionDays(config: CaptureDiagnosticsConfig): number {
  const days = config.captureTraceRetentionDays;
  if (typeof days !== "number" || !Number.isFinite(days)) {
    return DEFAULT_CAPTURE_TRACE_RETENTION_DAYS;
  }
  return Math.max(1, Math.floor(days));
}

/**
 * Delete trace files dated more than `captureTraceRetentionDays` before `now`.
 * The date comes from the file name, not the modification time, and files
 * that do not match the trace name pattern are never touched.
 */
export function pruneTraces(config: CaptureDiagnosticsConfig, now: Date = new Date()): number {
  const dir = getTraceDirectory();
  let removed = 0;
  try {
    if (!existsSync(dir)) return 0;
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    cutoff.setDate(cutoff.getDate() - retentionDays(config));
    for (const file of readdirSync(dir)) {
      const match = TRACE_FILE.exec(file);
      if (!match) continue;
      const fileDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      if (fileDate < cutoff) {
        unlinkSync(join(dir, file));
        removed++;
      }
    }
  } catch (error) {
    log("Capture trace cleanup failed", { code: errorCode(error) });
  }
  return removed;
}

let lastTraceDate: string | null = null;

/**
 * Append one trace entry to the day's JSON Lines file. A single append per
 * entry keeps lines whole when Pi and OpenCode write at the same time.
 */
export function writeTraceEntry(
  record: CaptureAttemptRecord,
  diagnostics: CaptureAttemptDiagnostics,
  config: CaptureDiagnosticsConfig,
  now: Date = new Date()
): void {
  try {
    const today = formatDate(now);
    if (lastTraceDate !== today) {
      lastTraceDate = today;
      pruneTraces(config, now);
    }

    const dir = getTraceDirectory();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);

    const redact = (value: string | undefined) =>
      value === undefined ? null : redactTraceText(value, config);
    const entry = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      timestamp: now.toISOString(),
      ...record,
      systemPrompt: redact(diagnostics.systemPrompt),
      userPrompt: redact(diagnostics.userPrompt),
      reply: redact(diagnostics.rawReply),
    };
    appendFileSync(join(dir, `capture-${today}.jsonl`), `${JSON.stringify(entry)}\n`, {
      mode: 0o600,
    });
  } catch (error) {
    log("Capture trace write failed", { code: errorCode(error) });
  }
}

/**
 * Write the attempt's metadata record to the log and, when tracing is on, its
 * trace entry. Never throws: diagnostics must not change a capture outcome.
 */
export function emitCaptureAttempt(
  record: CaptureAttemptRecord,
  diagnostics: CaptureAttemptDiagnostics,
  config: CaptureDiagnosticsConfig,
  now: Date = new Date()
): void {
  try {
    log("Capture attempt", record);
  } catch {
    // The log is best effort here, as everywhere else.
  }
  if (config.captureTrace === true) {
    writeTraceEntry(record, diagnostics, config, now);
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.name : "unknown";
}

/** Test hook: forget which day the last trace was written. */
export function resetTraceStateForTests(): void {
  lastTraceDate = null;
}
