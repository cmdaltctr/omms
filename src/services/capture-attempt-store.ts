import { join } from "node:path";
import { CONFIG } from "../config.js";
import type { CaptureAttemptRecord } from "./capture-diagnostics.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";

const prepared = new Set<string>();
// Keyed by path: a store change mid-preparation must prepare the new store too.
const preparing = new Map<string, Promise<void>>();

async function database() {
  const path = join(CONFIG.storagePath, "user-prompts.db");
  const db = await tursoConnectionManager.getConnection(path);
  if (!prepared.has(path)) {
    let pending = preparing.get(path);
    if (!pending) {
      pending = db
        .batch([
          {
            sql: `CREATE TABLE IF NOT EXISTS capture_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at INTEGER NOT NULL,
          host TEXT NOT NULL, source_type TEXT NOT NULL, session_id TEXT NOT NULL,
          path TEXT, provider TEXT, model TEXT, stop_reason TEXT, block_types TEXT,
          prompt_chars INTEGER, reply_chars INTEGER, duration_ms INTEGER NOT NULL,
          outcome TEXT NOT NULL, reason TEXT
        )`,
          },
          {
            sql: "CREATE INDEX IF NOT EXISTS idx_capture_attempts_time ON capture_attempts(created_at)",
          },
          {
            sql: "CREATE INDEX IF NOT EXISTS idx_capture_attempts_host_model ON capture_attempts(host, provider, model, created_at)",
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
export async function saveCaptureAttempt(
  record: CaptureAttemptRecord,
  now = Date.now()
): Promise<void> {
  const db = await database();
  await db.run(
    `INSERT INTO capture_attempts
    (created_at, host, source_type, session_id, path, provider, model, stop_reason,
     block_types, prompt_chars, reply_chars, duration_ms, outcome, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      now,
      record.host,
      record.sourceType,
      record.sessionId,
      record.path ?? null,
      record.provider ?? null,
      record.model ?? null,
      record.stopReason ?? null,
      record.blockTypes ? JSON.stringify(record.blockTypes) : null,
      record.promptChars ?? null,
      record.replyChars ?? null,
      record.durationMs,
      record.outcome,
      record.reason ?? null,
    ]
  );
}

/** True when any capture attempt from this host is recorded. */
export async function hasCaptureAttempts(host: string): Promise<boolean> {
  const db = await database();
  return Boolean(await db.get("SELECT 1 FROM capture_attempts WHERE host = ? LIMIT 1", [host]));
}

export async function pruneCaptureAttempts(days: number, now = Date.now()): Promise<number> {
  const db = await database();
  return db.run("DELETE FROM capture_attempts WHERE created_at < ?", [now - days * 86400000]);
}

export async function queryCaptureAttempts(from: number, to: number, limit = 100, host?: string) {
  const db = await database();
  // One optional clause keeps every list filtered the same way, so `recent` fills its limit.
  const where = host ? "created_at BETWEEN ? AND ? AND host = ?" : "created_at BETWEEN ? AND ?";
  const range = host ? [from, to, host] : [from, to];
  const byModel = await db.all(
    `SELECT host, provider, model, COUNT(*) AS total,
    SUM(CASE WHEN outcome = 'saved' THEN 1 ELSE 0 END) AS saved,
    SUM(CASE WHEN outcome = 'skipped' THEN 1 ELSE 0 END) AS skipped,
    SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM capture_attempts WHERE ${where}
    GROUP BY host, provider, model ORDER BY total DESC`,
    range
  );
  const byReason = await db.all(
    `SELECT host, provider, model, reason, COUNT(*) AS count
    FROM capture_attempts WHERE ${where} AND outcome = 'failed'
    GROUP BY host, provider, model, reason ORDER BY count DESC`,
    range
  );
  const recent = await db.all(
    `SELECT created_at AS timestamp, host,
    source_type AS sourceType, session_id AS sessionId, path, provider, model,
    stop_reason AS stopReason, block_types AS blockTypes, prompt_chars AS promptChars,
    reply_chars AS replyChars, duration_ms AS durationMs, outcome, reason
    FROM capture_attempts WHERE ${where}
    ORDER BY created_at DESC, id DESC LIMIT ?`,
    [...range, Math.max(1, Math.min(500, limit))]
  );
  return {
    byModel: byModel.map((row) => ({
      ...row,
      total: Number(row.total),
      saved: Number(row.saved),
      skipped: Number(row.skipped),
      failed: Number(row.failed),
    })),
    byReason: byReason.map((row) => ({
      host: String(row.host),
      provider: row.provider,
      model: row.model,
      reason: String(row.reason),
      count: Number(row.count),
    })),
    recent: recent.map((row) => ({
      ...row,
      blockTypes: row.blockTypes ? JSON.parse(String(row.blockTypes)) : null,
    })),
  };
}
