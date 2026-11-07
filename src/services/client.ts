import { embeddingService } from "./embedding.js";
import { tursoShardManager } from "./turso/shard-manager.js";
import { tursoVectorSearch } from "./turso/vector-search.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import { ensureTursoReady } from "./turso/ready.js";
import { formatTagsForEmbedding } from "./turso/vector-utils.js";
import { extractScopeFromContainerTag, resolveMemoryScope } from "./memory-scope.js";
import { rerankSettingsFrom } from "./reranker.js";
import { rerankedSearch } from "./retrieval-rerank.js";
import {
  findLinkedMemoryOwner,
  linkedRefusal,
  linkedSettingsFrom,
  listLinkedSpaces,
  mapListedMemory,
  searchLinkedSpaces,
  type MemoryReadOptions,
} from "./linked-search.js";
import { CONFIG } from "../config.js";
import { activeOwner } from "./active-space-access.js";
import { log } from "./logger.js";
import type { MemoryType } from "../types/index.js";
import type { MemoryRecord, SearchResult } from "./turso/types.js";

export type MemoryScope = "project" | "all-projects";

export class LocalMemoryClient {
  private initPromise: Promise<void> | null = null;
  private isInitialized: boolean = false;

  constructor() {}

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        await ensureTursoReady();
        this.isInitialized = true;
      } catch (error) {
        this.initPromise = null;
        log("Turso initialization failed", { error: String(error) }, "error");
        throw error;
      }
    })();

    return this.initPromise;
  }

  async warmup(progressCallback?: (progress: any) => void): Promise<void> {
    await this.initialize();
    await embeddingService.warmup(progressCallback);
  }

  async isReady(): Promise<boolean> {
    return this.isInitialized && embeddingService.isWarmedUp;
  }

  getEmbeddingInitError(): string | null {
    return embeddingService.initError;
  }

  getStatus(): {
    dbConnected: boolean;
    modelLoaded: boolean;
    ready: boolean;
    embeddingError: string | null;
  } {
    return {
      dbConnected: this.isInitialized,
      modelLoaded: embeddingService.isWarmedUp,
      ready: this.isInitialized && embeddingService.isWarmedUp,
      embeddingError: embeddingService.initError,
    };
  }

  reset(): void {
    this.isInitialized = false;
    this.initPromise = null;
  }

  async close(): Promise<void> {
    const { closeTursoAndInvalidateCaches } = await import("./turso/lifecycle.js");
    await closeTursoAndInvalidateCaches();
    this.reset();
  }

  async searchMemories(
    query: string,
    containerTag: string,
    scope: MemoryScope = "project",
    options: MemoryReadOptions = {}
  ) {
    // Capture the result count and the reranker settings at entry: initialize,
    // embedding, and shard reads all await, and a config edit during them must
    // not change this search's limit or reranker target.
    const maxMemories = CONFIG.maxMemories;
    const keywordBoost = CONFIG.keywordBoost;
    const reranker = rerankSettingsFrom(CONFIG);
    // The reranker path below always uses the boost: it needs a full pool on the similarity scale.
    const keywordMode = CONFIG.keywordMode;
    if (CONFIG.rerankerEnabled && !reranker) {
      // On but incomplete: search must keep working, so treat it as off.
      log("Reranker enabled without a URL or model; searching without it", {
        code: "reranker_not_configured",
      });
    }
    try {
      await this.initialize();

      const queryVector = await embeddingService.embedWithTimeout(query, { task: "query" });
      const resolved = resolveMemoryScope(scope, containerTag);
      const shards = (
        await Promise.all(
          resolved.map((ref) => tursoShardManager.getAllShards(ref.scope, ref.hash))
        )
      ).flat();

      let results: SearchResult[], warnings: string[];
      if (shards.length === 0) {
        // An empty own space still reads linked spaces when asked.
        results = [];
        warnings = [];
      } else if (reranker) {
        // One shard read with no threshold feeds both the reranker and the
        // fallback path (retrieval-rerank.ts, design decision 7).
        ({ results, warnings } = await rerankedSearch(
          {
            shards,
            queryVector,
            containerTag: scope === "all-projects" ? "" : containerTag,
            queryText: query,
            maxMemories,
            similarityThreshold: CONFIG.similarityThreshold,
          },
          reranker,
          {
            search: (shardList, vector, tag, limit, threshold, queryText) =>
              tursoVectorSearch.searchAcrossShards(
                shardList,
                vector,
                tag,
                limit,
                threshold,
                queryText,
                keywordBoost
              ),
            log: (message, meta) => log(message, meta),
          }
        ));
      } else {
        ({ results, warnings } = await tursoVectorSearch.searchAcrossShards(
          shards,
          queryVector,
          scope === "all-projects" ? "" : containerTag,
          maxMemories,
          CONFIG.similarityThreshold,
          query,
          keywordBoost,
          keywordMode
        ));
      }

      // Linked spaces fill only the places the own search left (D6); the reranker never sees them.
      if (options.includeLinked) {
        const linked = await searchLinkedSpaces({
          query,
          queryVector,
          scope,
          containerTag,
          ownCount: results.length,
          owner: activeOwner(),
          settings: linkedSettingsFrom(CONFIG),
        });
        results = [...results, ...linked.results];
        warnings = [...warnings, ...linked.warnings];
      }

      return {
        success: true as const,
        results,
        total: results.length,
        timing: 0,
        // The embedded prompt, so callers (the profile step) need not embed it again.
        queryVector,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("searchMemories: error", { error: errorMessage }, "error");
      return { success: false as const, error: errorMessage, results: [], total: 0, timing: 0 };
    }
  }

  async addMemory(
    content: string,
    containerTag: string,
    metadata?: {
      type?: MemoryType;
      source?: "manual" | "auto-capture" | "import" | "api";
      tags?: string[];
      tool?: string;
      sessionID?: string;
      reasoning?: string;
      captureTimestamp?: number;
      displayName?: string;
      userName?: string;
      userEmail?: string;
      projectPath?: string;
      projectName?: string;
      gitRepoUrl?: string;
      [key: string]: unknown;
    }
  ) {
    try {
      await this.initialize();

      const tags = metadata?.tags || [];
      const vector = await embeddingService.embedWithTimeout(content, { task: "document" });
      let tagsVector: Float32Array | undefined = undefined;

      if (tags.length > 0) {
        tagsVector = await embeddingService.embedWithTimeout(formatTagsForEmbedding(tags), {
          task: "document",
        });
      }

      const { scope, hash } = extractScopeFromContainerTag(containerTag);

      return tursoShardManager.withScopeWriteLock(scope, hash, async () => {
        const shard = await tursoShardManager.getWriteShard(scope, hash);

        const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const now = Date.now();

        const {
          displayName,
          userName,
          userEmail,
          projectPath,
          projectName,
          gitRepoUrl,
          type,
          tags: _tags,
          ...dynamicMetadata
        } = metadata || {};

        const record: MemoryRecord = {
          id,
          content,
          vector,
          tagsVector,
          containerTag,
          tags: tags.length > 0 ? tags.join(",") : undefined,
          type,
          createdAt: now,
          updatedAt: now,
          displayName,
          userName,
          userEmail,
          projectPath,
          projectName,
          gitRepoUrl,
          metadata:
            Object.keys(dynamicMetadata).length > 0 ? JSON.stringify(dynamicMetadata) : undefined,
        };

        const db = await tursoConnectionManager.getConnection(shard.dbPath);
        await tursoVectorSearch.insertVector(db, record);
        await tursoShardManager.incrementVectorCount(shard.id);

        return {
          success: true as const,
          id,
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("addMemory: error", { error: errorMessage }, "error");
      return { success: false as const, error: errorMessage };
    }
  }

  async deleteMemory(memoryId: string) {
    try {
      await this.initialize();

      const userShards = await tursoShardManager.getAllShards("user", "");
      const projectShards = await tursoShardManager.getAllShards("project", "");
      const allShards = [...userShards, ...projectShards];

      for (const shard of allShards) {
        const db = await tursoConnectionManager.getConnection(shard.dbPath);
        const memory = await tursoVectorSearch.getMemoryById(db, memoryId);

        if (memory) {
          await tursoVectorSearch.deleteVector(db, memoryId);
          await tursoShardManager.decrementVectorCount(shard.id);
          return { success: true };
        }
      }

      // A linked space is read-only: refuse with its name instead of "not found".
      const owner = await findLinkedMemoryOwner(
        memoryId,
        activeOwner(),
        linkedSettingsFrom(CONFIG)
      );
      if (owner) return linkedRefusal(owner.name);

      return { success: false, error: "Memory not found" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("deleteMemory: error", { memoryId, error: errorMessage }, "error");
      return { success: false, error: errorMessage };
    }
  }

  async listMemories(
    containerTag: string,
    limit = 20,
    scope: MemoryScope = "project",
    options: MemoryReadOptions = {}
  ) {
    try {
      await this.initialize();

      const resolved = resolveMemoryScope(scope, containerTag);
      const shards = (
        await Promise.all(
          resolved.map((ref) => tursoShardManager.getAllShards(ref.scope, ref.hash))
        )
      ).flat();

      let memories: any[];

      if (shards.length === 0) {
        // An empty own space still lists linked spaces when asked.
        memories = [];
      } else {
        const allMemories: any[] = [];

        for (const shard of shards) {
          const db = await tursoConnectionManager.getConnection(shard.dbPath);
          const rows = await tursoVectorSearch.listMemories(
            db,
            scope === "all-projects" ? "" : containerTag,
            limit
          );
          allMemories.push(...rows);
        }

        allMemories.sort((a, b) => Number(b.created_at) - Number(a.created_at));
        memories = allMemories.slice(0, limit).map((r: any) => mapListedMemory(r));
      }

      // Linked rows follow the own rows, newest first, within the limit (D6).
      if (options.includeLinked) {
        const linked = await listLinkedSpaces({
          scope,
          containerTag,
          limit,
          ownCount: memories.length,
          owner: activeOwner(),
          settings: linkedSettingsFrom(CONFIG),
        });
        memories = [...memories, ...linked.memories];
      }

      return {
        success: true as const,
        memories,
        pagination: { currentPage: 1, totalItems: memories.length, totalPages: 1 },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("listMemories: error", { error: errorMessage }, "error");
      return {
        success: false as const,
        error: errorMessage,
        memories: [],
        pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
      };
    }
  }

  async ensureStorageReady(): Promise<void> {
    await this.initialize();
  }

  async listShards(currentDirectory: string) {
    try {
      await this.initialize();
      const { shardInventoryService } = await import("./shard-inventory-service.js");
      return await shardInventoryService.listShards(currentDirectory);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("listShards: error", { error: errorMessage }, "error");
      return { success: false as const, error: errorMessage };
    }
  }

  async migrateProjectPath(options: {
    currentDirectory: string;
    fromPath?: string;
    fromHash?: string;
    dryRun?: boolean;
    allowLinkedSource?: boolean;
  }) {
    try {
      await this.initialize();
      const { shardPathMigrationService } = await import("./shard-path-migration-service.js");
      return await shardPathMigrationService.migrate(options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("migrateProjectPath: error", { error: errorMessage }, "error");
      return { success: false as const, dryRun: Boolean(options.dryRun), error: errorMessage };
    }
  }

  async exportMemories(currentDirectory: string, outputPath: string) {
    try {
      await this.initialize();
      const { memoryPortabilityService } = await import("./memory-portability-service.js");
      return await memoryPortabilityService.exportMemories({ currentDirectory, outputPath });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("exportMemories: error", { error: errorMessage }, "error");
      return { success: false as const, error: errorMessage };
    }
  }

  async importMemories(currentDirectory: string, inputPath: string, dryRun?: boolean) {
    try {
      await this.initialize();
      const { memoryPortabilityService } = await import("./memory-portability-service.js");
      return await memoryPortabilityService.importMemories({
        currentDirectory,
        inputPath,
        dryRun,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("importMemories: error", { error: errorMessage }, "error");
      return { success: false as const, dryRun: Boolean(dryRun), error: errorMessage };
    }
  }

  async searchMemoriesBySessionID(sessionID: string, containerTag: string, limit: number = 10) {
    try {
      await this.initialize();

      const { scope, hash } = extractScopeFromContainerTag(containerTag);
      const shards = await tursoShardManager.getAllShards(scope, hash);

      if (shards.length === 0) {
        return { success: true as const, results: [], total: 0, timing: 0 };
      }

      const allMemories: any[] = [];

      for (const shard of shards) {
        const db = await tursoConnectionManager.getConnection(shard.dbPath);
        const memories = await tursoVectorSearch.getMemoriesBySessionID(db, sessionID);
        allMemories.push(...memories);
      }

      allMemories.sort((a, b) => Number(b.created_at) - Number(a.created_at));

      const results = allMemories.slice(0, limit).map((row: any) => ({
        id: row.id,
        memory: row.content,
        similarity: 1.0,
        tags: row.tags || [],
        metadata: row.metadata || {},
        containerTag: row.container_tag,
        displayName: row.display_name,
        userName: row.user_name,
        userEmail: row.user_email,
        projectPath: row.project_path,
        projectName: row.project_name,
        gitRepoUrl: row.git_repo_url,
        createdAt: row.created_at,
      }));

      return { success: true as const, results, total: results.length, timing: 0 };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("searchMemoriesBySessionID: error", { error: errorMessage }, "error");
      return { success: false as const, error: errorMessage, results: [], total: 0, timing: 0 };
    }
  }
}

export const memoryClient = new LocalMemoryClient();
