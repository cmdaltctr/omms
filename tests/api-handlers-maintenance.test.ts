import { afterEach, describe, expect, it } from "bun:test";

describe("api handlers: maintenance routes", () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    while (restores.length) restores.pop()!();
  });

  /** Replaces one method on a service singleton for the length of a test. */
  function stub<T extends object, K extends keyof T>(target: T, key: K, fn: unknown): void {
    const original = target[key];
    (target as Record<K, unknown>)[key] = fn;
    restores.push(() => {
      target[key] = original;
    });
  }

  it("runs the cleanup service and returns its result", async () => {
    const { cleanupService } = await import("../src/services/cleanup-service.js");
    const result = { deletedCount: 3, userCount: 1, projectCount: 2 };
    stub(cleanupService, "runCleanup", async () => result);

    const { handleRunCleanup } = await import("../src/services/api-handlers.js");
    expect(await handleRunCleanup()).toEqual({ success: true, data: result });
  });

  it("reports a cleanup failure as an error response", async () => {
    const { cleanupService } = await import("../src/services/cleanup-service.js");
    stub(cleanupService, "runCleanup", async () => {
      throw new Error("cleanup boom");
    });

    const { handleRunCleanup } = await import("../src/services/api-handlers.js");
    const response = await handleRunCleanup();
    expect(response.success).toBe(false);
    expect(response.error).toContain("cleanup boom");
  });

  it("runs deduplication and returns its result", async () => {
    const { deduplicationService } = await import("../src/services/deduplication-service.js");
    const result = { exactDuplicatesDeleted: 4, nearDuplicateGroups: [] };
    stub(deduplicationService, "detectAndRemoveDuplicates", async () => result);

    const { handleRunDeduplication } = await import("../src/services/api-handlers.js");
    expect(await handleRunDeduplication()).toEqual({ success: true, data: result });
  });

  it("reports a deduplication failure as an error response", async () => {
    const { deduplicationService } = await import("../src/services/deduplication-service.js");
    stub(deduplicationService, "detectAndRemoveDuplicates", async () => {
      throw new Error("dedupe boom");
    });

    const { handleRunDeduplication } = await import("../src/services/api-handlers.js");
    const response = await handleRunDeduplication();
    expect(response.success).toBe(false);
    expect(response.error).toContain("dedupe boom");
  });

  it("detects a model migration and returns the mismatch report", async () => {
    const { migrationService } = await import("../src/services/migration-service.js");
    const result = {
      needsMigration: true,
      configDimensions: 768,
      configModel: "model-x",
      shardMismatches: [{ shardId: 1 }],
    };
    stub(migrationService, "detectDimensionMismatch", async () => result);

    const { handleDetectMigration } = await import("../src/services/api-handlers.js");
    expect(await handleDetectMigration()).toEqual({ success: true, data: result });
  });

  it("reports a detection failure as an error response", async () => {
    const { migrationService } = await import("../src/services/migration-service.js");
    stub(migrationService, "detectDimensionMismatch", async () => {
      throw new Error("detect boom");
    });

    const { handleDetectMigration } = await import("../src/services/api-handlers.js");
    const response = await handleDetectMigration();
    expect(response.success).toBe(false);
    expect(response.error).toContain("detect boom");
  });

  it("passes the strategy to the migration and mirrors its success flag", async () => {
    const { migrationService } = await import("../src/services/migration-service.js");
    const strategies: string[] = [];
    const outcome = (success: boolean, strategy: string) => ({
      success,
      strategy,
      deletedShards: 1,
      reEmbeddedMemories: 2,
      duration: 3,
    });
    stub(migrationService, "migrateToNewModel", async (strategy: string) => {
      strategies.push(strategy);
      return outcome(strategy === "re-embed", strategy);
    });

    const { handleRunMigration } = await import("../src/services/api-handlers.js");
    expect(await handleRunMigration("re-embed")).toEqual({
      success: true,
      data: outcome(true, "re-embed"),
    });
    expect(await handleRunMigration("fresh-start")).toEqual({
      success: false,
      data: outcome(false, "fresh-start"),
    });
    expect(strategies).toEqual(["re-embed", "fresh-start"]);
  });

  it("reports a migration failure as an error response", async () => {
    const { migrationService } = await import("../src/services/migration-service.js");
    stub(migrationService, "migrateToNewModel", async () => {
      throw new Error("migrate boom");
    });

    const { handleRunMigration } = await import("../src/services/api-handlers.js");
    const response = await handleRunMigration("re-embed");
    expect(response.success).toBe(false);
    expect(response.error).toContain("migrate boom");
  });
});
