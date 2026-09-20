import { runLegacyTursoMigration } from "./legacy-migrator.js";
import { runStartupTagPrefixGate } from "../tag-prefix-migration.js";
import { tursoShardManager } from "./shard-manager.js";
import { log } from "../logger.js";

let initPromise: Promise<void> | null = null;
let isReady = false;

export async function ensureTursoReady(): Promise<void> {
  if (isReady) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await runLegacyTursoMigration();
      // Gate every read/write on the one-time container tag prefix migration:
      // either the store is fully on omms_, or initialisation fails loudly
      // (no silent dual-prefix fallback). Skipped under
      // OMMS_SKIP_TAG_PREFIX_MIGRATION=1 (tests).
      await runStartupTagPrefixGate();
      const { shardPathMigrationService } = await import("../shard-path-migration-service.js");
      await shardPathMigrationService.recoverInterruptedSwap();
      await tursoShardManager.getAllShards("user", "");
      isReady = true;
    } catch (error) {
      initPromise = null;
      log("Turso ready gate failed", { error: String(error) });
      throw error;
    }
  })();

  return initPromise;
}

export function resetTursoReady(): void {
  isReady = false;
  initPromise = null;
}
