import { join } from "node:path";
import type { CaptureWorkUnit } from "../core/capture.js";
import { captureRetryDelayMs, type CaptureFailureInfo } from "../core/capture-retry-policy.js";
import type { MemoryHost } from "../types/index.js";
import { redactTraceText, type CaptureDiagnosticsConfig } from "./capture-diagnostics.js";
import { log } from "./logger.js";
import { isFullyPrivate } from "./privacy.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";

/**
 * The config fields this module reads. Callers pass `CONFIG`, so tests that
 * stub `../config.js` do not need the new key.
 */
export interface CaptureRetryConfig extends CaptureDiagnosticsConfig {
  storagePath: string;
  captureRetryRetentionHours?: number;
}

export interface QueuedCaptureRetry {
  id: number;
  host: MemoryHost;
  sessionId: string;
  turnId: string;
  workUnit: CaptureWorkUnit;
  createdAt: number;
  attempts: number;
}

export type EnqueueResult = "queued" | "off" | "private" | "too-large" | "no-turn-id";

export const DEFAULT_CAPTURE_RETRY_RETENTION_HOURS = 72;
export const MAX_QUEUED_TURN_BYTES = 256 * 1024;
export const MAX_QUEUE_BYTES = 20 * 1024 * 1024;
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Whole hours from 0 to 720; a stub config without the key gets the default. */
export function captureRetryRetentionHours(config: CaptureRetryConfig): number {
  const hours = config.captureRetryRetentionHours;
  if (typeof hours !== "number" || !Number.isFinite(hours)) {
    return DEFAULT_CAPTURE_RETRY_RETENTION_HOURS;
  }
  return Math.min(720, Math.max(0, Math.floor(hours)));
}

export function isCaptureRetryEnabled(config: CaptureRetryConfig): boolean {
  return captureRetryRetentionHours(config) > 0;
}

const prepared = new Set<string>();
// Keyed by path: a store change mid-preparation must prepare the new store too.
const preparing = new Map<string, Promise<void>>();

async function database(config: CaptureRetryConfig) {
  const path = join(config.storagePath, "user-prompts.db");
  const db = await tursoConnectionManager.getConnection(path);
  if (!prepared.has(path)) {
    let pending = preparing.get(path);
    if (!pending) {
      pending = db
        .batch([
          {
            sql: `CREATE TABLE IF NOT EXISTS capture_retry_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host TEXT NOT NULL, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
          project_directory TEXT NOT NULL, work_unit TEXT NOT NULL,
          size_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL,
          last_reason TEXT, claimed_until INTEGER,
          UNIQUE (host, turn_id)
        )`,
          },
          {
            sql: "CREATE INDEX IF NOT EXISTS idx_capture_retry_due ON capture_retry_queue(host, next_attempt_at)",
          },
        ])
        .then(() => {
          prepared.add(path);
        })
        .finally(() => {
          preparing.delete(path);
        });
      preparing.set(path, pending);
    }
    await pending;
  }
  return db;
}

/** Text with something left after `<private>` removal. */
function hasContent(text: string): boolean {
  return !isFullyPrivate(text);
}

/**
 * Remove `<private>` text and redact secrets with the trace rules. Returns
 * null for a turn with no text left, which must not be queued.
 */
export function cleanCaptureWorkUnit(
  unit: CaptureWorkUnit,
  config: CaptureRetryConfig
): CaptureWorkUnit | null {
  const clean = (text: string) => redactTraceText(text, config);
  const textResponses = unit.textResponses.filter(hasContent).map(clean);
  const toolCalls = unit.toolCalls
    .filter((call) => hasContent(call.input))
    .map((call) => ({ name: call.name, input: clean(call.input) }));
  if (!hasContent(unit.userPrompt) && textResponses.length === 0 && toolCalls.length === 0) {
    return null;
  }
  return { ...unit, userPrompt: clean(unit.userPrompt), textResponses, toolCalls };
}

/**
 * Save a cleaned copy of a turn whose live capture failed with a retryable
 * error. Queueing the same turn again updates its row.
 */
export async function enqueueCaptureRetry(
  unit: CaptureWorkUnit,
  failure: CaptureFailureInfo,
  config: CaptureRetryConfig,
  now = Date.now()
): Promise<EnqueueResult> {
  if (!isCaptureRetryEnabled(config)) return "off";
  const turnId = unit.promptId;
  if (!turnId) return "no-turn-id";
  const cleaned = cleanCaptureWorkUnit(unit, config);
  if (!cleaned) return "private";
  const json = JSON.stringify(cleaned);
  const size = Buffer.byteLength(json, "utf8");
  if (size > MAX_QUEUED_TURN_BYTES) {
    log("Capture retry skipped: turn too large", { sessionID: unit.hostSessionId, size });
    return "too-large";
  }

  const db = await database(config);
  const existing = await db.get(
    "SELECT attempts FROM capture_retry_queue WHERE host = ? AND turn_id = ?",
    [unit.host, turnId]
  );
  const attempts = existing ? Number(existing.attempts) + 1 : 1;
  await makeRoom(config, size, unit.host, turnId);
  await db.run(
    `INSERT INTO capture_retry_queue
    (host, session_id, turn_id, project_directory, work_unit, size_bytes, created_at,
     attempts, next_attempt_at, last_reason, claimed_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT (host, turn_id) DO UPDATE SET
      work_unit = excluded.work_unit, size_bytes = excluded.size_bytes,
      attempts = excluded.attempts, next_attempt_at = excluded.next_attempt_at,
      last_reason = excluded.last_reason`,
    [
      unit.host,
      unit.hostSessionId,
      turnId,
      unit.projectDirectory,
      json,
      size,
      now,
      attempts,
      now + captureRetryDelayMs(attempts, failure.retryAfterMs),
      failure.reason,
    ]
  );
  return "queued";
}

/** Delete the oldest rows until a new row of `size` bytes fits under the cap. */
async function makeRoom(
  config: CaptureRetryConfig,
  size: number,
  host: MemoryHost,
  turnId: string
): Promise<void> {
  const db = await database(config);
  const rows = await db.all(
    `SELECT id, size_bytes FROM capture_retry_queue
    WHERE NOT (host = ? AND turn_id = ?) ORDER BY created_at DESC, id DESC`,
    [host, turnId]
  );
  let total = size;
  const remove: number[] = [];
  for (const row of rows) {
    total += Number(row.size_bytes);
    // Newest first: once past the cap, this row and every older one go.
    if (total > MAX_QUEUE_BYTES) remove.push(Number(row.id));
  }
  for (const id of remove) {
    await db.run("DELETE FROM capture_retry_queue WHERE id = ?", [id]);
  }
}

/** This host's rows that are due, oldest first. */
export async function listDueCaptureRetries(
  host: MemoryHost,
  config: CaptureRetryConfig,
  now = Date.now()
): Promise<QueuedCaptureRetry[]> {
  const db = await database(config);
  const rows = await db.all(
    `SELECT id, host, session_id, turn_id, work_unit, created_at, attempts
    FROM capture_retry_queue WHERE host = ? AND next_attempt_at <= ?
    ORDER BY created_at, id`,
    [host, now]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    host: String(row.host) as MemoryHost,
    sessionId: String(row.session_id),
    turnId: String(row.turn_id),
    workUnit: JSON.parse(String(row.work_unit)) as CaptureWorkUnit,
    createdAt: Number(row.created_at),
    attempts: Number(row.attempts),
  }));
}

/**
 * Claim a row for one retry. Only one process can hold a live claim; a
 * crashed process releases it when the lease runs out.
 */
export async function claimCaptureRetry(
  id: number,
  config: CaptureRetryConfig,
  now = Date.now()
): Promise<boolean> {
  const db = await database(config);
  const changed = await db.run(
    `UPDATE capture_retry_queue SET claimed_until = ?
    WHERE id = ? AND (claimed_until IS NULL OR claimed_until < ?)`,
    [now + CLAIM_LEASE_MS, id, now]
  );
  return changed === 1;
}

/** Record one more failed try, set the next try time and release the claim. */
export async function rescheduleCaptureRetry(
  row: Pick<QueuedCaptureRetry, "id" | "attempts">,
  failure: CaptureFailureInfo,
  config: CaptureRetryConfig,
  now = Date.now()
): Promise<void> {
  const db = await database(config);
  const attempts = row.attempts + 1;
  await db.run(
    `UPDATE capture_retry_queue
    SET attempts = ?, next_attempt_at = ?, last_reason = ?, claimed_until = NULL WHERE id = ?`,
    [attempts, now + captureRetryDelayMs(attempts, failure.retryAfterMs), failure.reason, row.id]
  );
}

export async function deleteCaptureRetry(id: number, config: CaptureRetryConfig): Promise<void> {
  const db = await database(config);
  await db.run("DELETE FROM capture_retry_queue WHERE id = ?", [id]);
}

/** Queued turns per host. */
export async function countCaptureRetries(
  config: CaptureRetryConfig
): Promise<Record<MemoryHost, number>> {
  const db = await database(config);
  const rows = await db.all(
    "SELECT host, COUNT(*) AS count FROM capture_retry_queue GROUP BY host"
  );
  const counts: Record<MemoryHost, number> = { opencode: 0, pi: 0, "claude-code": 0 };
  for (const row of rows) {
    const host = String(row.host);
    if (host === "opencode" || host === "pi" || host === "claude-code") {
      counts[host] = Number(row.count);
    }
  }
  return counts;
}

/** Make every row of one host due now. Returns the number of rows. */
export async function makeCaptureRetriesDue(
  host: MemoryHost,
  config: CaptureRetryConfig,
  now = Date.now()
): Promise<number> {
  const db = await database(config);
  return db.run("UPDATE capture_retry_queue SET next_attempt_at = ? WHERE host = ?", [now, host]);
}

/**
 * Delete rows older than the retention. With retention 0 the queue is off,
 * so every row goes.
 */
export async function pruneCaptureRetries(
  config: CaptureRetryConfig,
  now = Date.now()
): Promise<number> {
  const db = await database(config);
  const hours = captureRetryRetentionHours(config);
  if (hours === 0) return db.run("DELETE FROM capture_retry_queue");
  return db.run("DELETE FROM capture_retry_queue WHERE created_at < ?", [now - hours * HOUR_MS]);
}
