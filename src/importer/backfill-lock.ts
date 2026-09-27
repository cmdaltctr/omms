import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { CONFIG } from "../config.js";
import { tursoConnectionManager } from "../services/turso/connection-manager.js";
import type { BackfillHost } from "./backfill-model.js";

type LockState = { pid: number; token: string };

function live(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Claim one host's import without holding a database transaction during the run. */
export async function tryAcquireBackfillLock(
  host: BackfillHost,
  storagePath = CONFIG.storagePath
): Promise<(() => Promise<void>) | null> {
  const db = await tursoConnectionManager.getConnection(join(storagePath, "import-ledger.db"));
  await db.run(`CREATE TABLE IF NOT EXISTS backfill_locks (
    host TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL
  )`);
  const state: LockState = { pid: process.pid, token: randomUUID() };
  for (let attempt = 0; attempt < 3; attempt++) {
    const inserted = await db.run(
      "INSERT OR IGNORE INTO backfill_locks (host, pid, token) VALUES (?, ?, ?)",
      [host, state.pid, state.token]
    );
    if (!inserted) {
      const holder = await db.get<LockState>(
        "SELECT pid, token FROM backfill_locks WHERE host = ?",
        [host]
      );
      if (!holder) continue;
      if (live(holder.pid)) return null;
      const replaced = await db.run(
        "UPDATE backfill_locks SET pid = ?, token = ? WHERE host = ? AND pid = ? AND token = ?",
        [state.pid, state.token, host, holder.pid, holder.token]
      );
      if (!replaced) continue;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await db.run("DELETE FROM backfill_locks WHERE host = ? AND token = ?", [host, state.token]);
    };
  }
  return null;
}
