import { join } from "node:path";
import { CONFIG } from "../../config.js";
import { tursoConnectionManager } from "../turso/connection-manager.js";
import type { TursoDb } from "../turso/turso-db.js";

/** One batch with its retry at the 120-second limit fits well inside this. */
export const LEASE_EXPIRY_MS = 10 * 60 * 1000;
const WAIT_MS = 1000;

export type BatchStart = "ok" | "superseded" | "aborted";

/**
 * The catch-up run record, shared by the web app and the terminal command
 * through `user-prompts.db`. The newest run owns the record. A run sends a
 * batch only while it owns the record and no other run is mid-batch, so no
 * batch is sent twice. A record not refreshed for 10 minutes has expired.
 */
export class CatchUpLease {
  private prepared: Promise<TursoDb> | null = null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly options: {
      path?: string;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    } = {}
  ) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private db(): Promise<TursoDb> {
    this.prepared ??= (async () => {
      const path = this.options.path ?? join(CONFIG.storagePath, "user-prompts.db");
      const db = await tursoConnectionManager.getConnection(path);
      await db.run(`CREATE TABLE IF NOT EXISTS profile_catch_up_lease (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner TEXT NOT NULL, busy_owner TEXT, refreshed_at INTEGER NOT NULL
      )`);
      return db;
    })();
    return this.prepared;
  }

  /** Become the owner. The previous owner's mid-batch mark stays until its batch ends. */
  async take(owner: string): Promise<void> {
    const db = await this.db();
    await db.run(
      `INSERT INTO profile_catch_up_lease (id, owner, busy_owner, refreshed_at)
      VALUES (1, ?, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET owner = excluded.owner`,
      [owner, this.now()]
    );
  }

  /** Wait until this run may send its next batch, or report that a newer run took over. */
  async beginBatch(
    owner: string,
    options: { signal?: AbortSignal; onWait?: () => void } = {}
  ): Promise<BatchStart> {
    const db = await this.db();
    for (;;) {
      if (options.signal?.aborted) return "aborted";
      const now = this.now();
      const changed = await db.run(
        `UPDATE profile_catch_up_lease SET busy_owner = ?, refreshed_at = ?
        WHERE id = 1 AND owner = ?
          AND (busy_owner IS NULL OR busy_owner = ? OR refreshed_at < ?)`,
        [owner, now, owner, owner, now - LEASE_EXPIRY_MS]
      );
      if (changed > 0) return "ok";
      const row = await db.get("SELECT owner FROM profile_catch_up_lease WHERE id = 1");
      if (!row || String(row.owner) !== owner) return "superseded";
      options.onWait?.();
      await this.sleep(WAIT_MS);
    }
  }

  /** Clear this run's mid-batch mark, also after a newer run took over. */
  async endBatch(owner: string): Promise<void> {
    const db = await this.db();
    await db.run(
      "UPDATE profile_catch_up_lease SET busy_owner = NULL, refreshed_at = ? WHERE busy_owner = ?",
      [this.now(), owner]
    );
  }

  /** Remove the record only when this run still owns it. */
  async release(owner: string): Promise<void> {
    const db = await this.db();
    await db.run("DELETE FROM profile_catch_up_lease WHERE id = 1 AND owner = ?", [owner]);
  }

  /** True while an unexpired record exists; a live pass skips meanwhile. */
  async isActive(): Promise<boolean> {
    const db = await this.db();
    const row = await db.get(
      "SELECT 1 FROM profile_catch_up_lease WHERE id = 1 AND refreshed_at >= ?",
      [this.now() - LEASE_EXPIRY_MS]
    );
    return Boolean(row);
  }
}
