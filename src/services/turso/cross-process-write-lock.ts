import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "../../config.js";

/**
 * Cross-process advisory write lock, one per (scope, scopeHash).
 *
 * The in-process write queue in shard-manager only serialises writers inside
 * one process. When two hosts (OpenCode and Pi, or two test workers) write the
 * same project shard set concurrently, their read-modify-write sequences can
 * interleave: COUNT()-based vector-count syncs straddle another process's
 * insert-then-increment and double-count, and rollover decisions race. This
 * lock serialises the whole write critical section across processes while
 * leaving readers lock-free (WAL mode keeps them concurrent).
 *
 * Semantics match turso/operation-lock: PID-liveness staleness detection, so a
 * crashed holder is cleaned up by the next acquirer. Acquisition blocks with
 * polling and a timeout that fails loudly instead of hanging.
 */

const WRITE_LOCK_DIR = ".write-locks";
const LOCK_TIMEOUT_MS = 15000;
const LOCK_POLL_MS = 15;

interface LockState {
  pid: number;
  timestamp: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLiveLock(path: string): LockState | null {
  if (!existsSync(path)) return null;
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as LockState;
    if (Number.isInteger(state.pid) && state.pid > 0 && isProcessAlive(state.pid)) {
      return state;
    }
  } catch {
    // Corrupt lock files are stale; remove below.
  }
  try {
    unlinkSync(path);
  } catch {
    // Already removed by a racing acquirer — retry the acquisition.
  }
  return null;
}

function lockFilePath(scope: string, hash: string): string {
  return join(CONFIG.storagePath, WRITE_LOCK_DIR, `${scope}_${hash}.lock`);
}

export async function withCrossProcessWriteLock<T>(
  scope: "user" | "project",
  hash: string,
  fn: () => Promise<T>
): Promise<T> {
  const dir = join(CONFIG.storagePath, WRITE_LOCK_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const path = lockFilePath(scope, hash);
  const state: LockState = { pid: process.pid, timestamp: new Date().toISOString() };
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      writeFileSync(path, JSON.stringify(state), { flag: "wx" });
      break;
    } catch {
      const holder = readLiveLock(path);
      if (!holder) continue;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out acquiring the cross-process write lock for ${scope}/${hash}: ` +
            `held by pid ${holder.pid} since ${holder.timestamp}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS + Math.random() * 10));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Best effort: a stale file is cleaned up by the next acquirer.
    }
  }
}
