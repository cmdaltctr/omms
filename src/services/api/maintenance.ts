import { log } from "../logger.js";
import { runTagMigrationBatch } from "../tag-migration.js";
import { apiConfig, type ApiResponse } from "./shared.js";

export async function handleRunCleanup(): Promise<
  ApiResponse<{ deletedCount: number; userCount: number; projectCount: number }>
> {
  try {
    const { cleanupService } = await import("../cleanup-service.js");
    const result = await cleanupService.runCleanup();
    return { success: true, data: result };
  } catch (error) {
    log("handleRunCleanup: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleRunDeduplication(): Promise<
  ApiResponse<{ exactDuplicatesDeleted: number; nearDuplicateGroups: any[] }>
> {
  try {
    const { deduplicationService } = await import("../deduplication-service.js");
    const result = await deduplicationService.detectAndRemoveDuplicates();
    return { success: true, data: result };
  } catch (error) {
    log("handleRunDeduplication: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleDetectMigration(): Promise<
  ApiResponse<{
    needsMigration: boolean;
    configDimensions: number;
    configModel: string;
    shardMismatches: any[];
  }>
> {
  try {
    const { migrationService } = await import("../migration-service.js");
    const result = await migrationService.detectDimensionMismatch();
    return { success: true, data: result };
  } catch (error) {
    log("handleDetectMigration: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleRunMigration(strategy: "fresh-start" | "re-embed"): Promise<
  ApiResponse<{
    success: boolean;
    strategy: string;
    deletedShards: number;
    reEmbeddedMemories: number;
    duration: number;
    error?: string;
  }>
> {
  try {
    const { migrationService } = await import("../migration-service.js");
    const result = await migrationService.migrateToNewModel(strategy);
    return { success: result.success, data: result };
  } catch (error) {
    log("handleRunMigration: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export { handleDetectTagMigration, handleGetTagMigrationProgress } from "../tag-migration.js";

/** Tags untagged memories with the memory model. The work lives in tag-migration.ts. */
export async function handleRunTagMigrationBatch(batchSize: number = 5) {
  return runTagMigrationBatch(apiConfig(), batchSize);
}
