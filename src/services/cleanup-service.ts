import { tursoShardManager } from "./turso/shard-manager.js";
import { tursoVectorSearch } from "./turso/vector-search.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import { ensureTursoReady } from "./turso/ready.js";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import { userPromptManager } from "./user-prompt/user-prompt-manager.js";
import { memoryKindPredicate } from "./memory-kind.js";

interface CleanupResult {
  deletedCount: number;
  userCount: number;
  projectCount: number;
  promptsDeleted: number;
  linkedMemoriesDeleted: number;
  pinnedMemoriesSkipped: number;
}

// Derived from the connection manager, so this file adds no storage import (modularity ratchet).
type ShardDb = Awaited<ReturnType<typeof tursoConnectionManager.getConnection>>;

/** The memories a deletion would remove, per shard of the active space. */
interface OldMemories {
  shards: { shardId: number; db: ShardDb; memories: Record<string, unknown>[] }[];
  pinnedSkipped: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// The daily timer checks hourly; the once-a-day guard decides whether a run is due.
const TIMER_CHECK_MS = 60 * 60 * 1000;

const NOTHING_DELETED: CleanupResult = {
  deletedCount: 0,
  userCount: 0,
  projectCount: 0,
  promptsDeleted: 0,
  linkedMemoriesDeleted: 0,
  pinnedMemoriesSkipped: 0,
};

export class CleanupService {
  private lastCleanupTime: number = 0;
  private isRunning: boolean = false;

  /** True at most once a day per process, while no run is in progress. Reads no config switch. */
  async shouldRunCleanup(): Promise<boolean> {
    if (this.isRunning) return false;
    return Date.now() - this.lastCleanupTime >= DAY_MS;
  }

  /**
   * The automatic daily run on every host. Housekeeping always runs. Memories and prompts
   * are deleted by age only when `deleteOld` is true; callers pass `autoDeleteOldMemories`
   * (ADR-051). Does nothing when the once-a-day guard says a run is not due.
   */
  async runDailyMaintenance(deleteOld: boolean): Promise<void> {
    if (!(await this.shouldRunCleanup())) return;
    await this.run(deleteOld === true, "daily");
  }

  /** The manual Cleanup button: deletes by age and runs housekeeping, after the page's confirm. */
  async runCleanup(): Promise<CleanupResult> {
    if (this.isRunning) {
      throw new Error("Cleanup already running");
    }
    return this.run(true, "manual");
  }

  /** How many memories a deletion with `retentionDays` would remove now. Deletes nothing. */
  async countCleanupCandidates(retentionDays: number): Promise<number> {
    await ensureTursoReady();
    const cutoffTime = Date.now() - retentionDays * DAY_MS;
    const found = await this.findOldMemories(cutoffTime);
    return found.shards.reduce((total, shard) => total + shard.memories.length, 0);
  }

  private async run(deleteOld: boolean, trigger: "daily" | "manual"): Promise<CleanupResult> {
    this.isRunning = true;
    this.lastCleanupTime = Date.now();

    try {
      await ensureTursoReady();
      const result = deleteOld ? await this.deleteOldMemories() : NOTHING_DELETED;
      // Counts and days only: never memory text, ids or project names (CLAUDE.md Security).
      if (result.deletedCount > 0 || result.promptsDeleted > 0) {
        log("Cleanup: old memories deleted", {
          memories: result.deletedCount,
          prompts: result.promptsDeleted,
          retentionDays: CONFIG.autoCleanupRetentionDays,
          trigger,
        });
      }
      await this.runHousekeeping();
      return result;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Old unpinned memories in every shard of the active space. The one selection behind both the
   * delete and the count, so the confirm dialog shows what a run removes. A memory linked to an
   * old prompt goes in the same run as its prompt (ADR-051).
   */
  private async findOldMemories(cutoffTime: number): Promise<OldMemories> {
    const userShards = await tursoShardManager.getAllShards("user", "");
    const projectShards = await tursoShardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    const pinnedMemoryIds = new Set<string>();
    for (const shard of allShards) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const pinned = await db.all(`SELECT id FROM memories WHERE is_pinned = 1`);
      pinned.forEach((row) => pinnedMemoryIds.add(String(row.id)));
    }

    const found: OldMemories = { shards: [], pinnedSkipped: 0 };
    for (const shard of allShards) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const oldMemories = await db.all(
        `
          SELECT id, container_tag, is_pinned FROM memories
          WHERE updated_at < ? AND ${memoryKindPredicate()}
        `,
        [cutoffTime]
      );
      const memories = oldMemories.filter((memory) => {
        if (Number(memory.is_pinned) === 1) {
          found.pinnedSkipped++;
          return false;
        }
        return !pinnedMemoryIds.has(String(memory.id));
      });
      found.shards.push({ shardId: shard.id, db, memories });
    }
    return found;
  }

  private async deleteOldMemories(): Promise<CleanupResult> {
    const cutoffTime = Date.now() - CONFIG.autoCleanupRetentionDays * DAY_MS;
    const promptCleanupResult = await userPromptManager.deleteOldPrompts(cutoffTime);
    const linkedMemoryIds = new Set(promptCleanupResult.linkedMemoryIds);
    const found = await this.findOldMemories(cutoffTime);

    let totalDeleted = 0;
    let userDeleted = 0;
    let projectDeleted = 0;
    let linkedDeleted = 0;

    for (const { shardId, db, memories } of found.shards) {
      for (const memory of memories) {
        try {
          await tursoVectorSearch.deleteVector(db, String(memory.id));
          await tursoShardManager.decrementVectorCount(shardId);
          totalDeleted++;
          if (linkedMemoryIds.has(String(memory.id))) linkedDeleted++;

          if (String(memory.container_tag).includes("_user_")) {
            userDeleted++;
          } else if (String(memory.container_tag).includes("_project_")) {
            projectDeleted++;
          }
        } catch (error) {
          log("Cleanup: delete error", { memoryId: memory.id, error: String(error) }, "error");
        }
      }
    }

    return {
      deletedCount: totalDeleted,
      userCount: userDeleted,
      projectCount: projectDeleted,
      promptsDeleted: promptCleanupResult.deleted,
      linkedMemoriesDeleted: linkedDeleted,
      pinnedMemoriesSkipped: found.pinnedSkipped,
    };
  }

  /** Record-keeping tables and VACUUM. Reads neither deletion key and deletes no memory. */
  private async runHousekeeping(): Promise<void> {
    try {
      const { pruneCaptureAttempts } = await import("./capture-attempt-store.js");
      await pruneCaptureAttempts(CONFIG.captureAttemptRetentionDays);
    } catch (error) {
      log(
        "Capture attempt cleanup failed",
        {
          code: error instanceof Error ? error.name : "unknown",
        },
        "error"
      );
    }

    try {
      const { pruneCaptureRetries } = await import("./capture-retry-queue.js");
      await pruneCaptureRetries(CONFIG);
    } catch (error) {
      log(
        "Capture retry cleanup failed",
        {
          code: error instanceof Error ? error.name : "unknown",
        },
        "error"
      );
    }

    try {
      const { pruneAutoCleanupRecords } = await import("./user-profile/auto-cleanup-store.js");
      await pruneAutoCleanupRecords();
    } catch (error) {
      log(
        "Automatic cleanup record cleanup failed",
        {
          code: error instanceof Error ? error.name : "unknown",
        },
        "error"
      );
    }

    try {
      await userPromptManager.vacuum();
      log("Cleanup: VACUUM done", { db: "user-prompts.db" });
    } catch (err) {
      log("Cleanup: VACUUM skipped (DB busy)", { error: String(err) }, "warn");
    }
  }

  getStatus() {
    return {
      enabled: CONFIG.autoDeleteOldMemories === true,
      retentionDays: CONFIG.autoCleanupRetentionDays,
      lastCleanupTime: this.lastCleanupTime,
      isRunning: this.isRunning,
    };
  }
}

export const cleanupService = new CleanupService();

/**
 * The web app's daily run, which also covers Claude Code. Runs once now, then checks every
 * hour; the once-a-day guard skips a run that is not due. Deletion follows
 * `autoDeleteOldMemories` only. Returns a function that stops the timer.
 */
export function startDailyMaintenanceTimer(): () => void {
  const tick = () => {
    cleanupService
      .runDailyMaintenance(CONFIG.autoDeleteOldMemories === true)
      .catch((error: unknown) => {
        log(
          "Daily maintenance failed",
          { code: error instanceof Error ? error.name : "unknown" },
          "error"
        );
      });
  };
  tick();
  const timer = setInterval(tick, TIMER_CHECK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
