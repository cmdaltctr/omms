import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getEmbeddingDimensions, getEmbeddingModel } from "./active-space-access.js";
import {
  MemoryExportDocumentSchema,
  PORTABILITY_SCHEMA_VERSION,
  type ExportedMemory,
  type MemoryExportDocument,
} from "../shared/api/portability-schemas.js";
import { extractScopeFromContainerTag } from "./memory-scope.js";
import { getProjectTagInfo } from "./tags.js";
import { embeddingService } from "./embedding.js";
import {
  acquireMemoryOperationLock,
  createMemoryShard,
  ensureMemoryStoreReady,
  getActiveMemoryShard,
  listMemoryShards,
  setShardCount,
  withMemoryScopeWriteLock,
} from "./storage/memory/shards.js";
import {
  allMemoryRows,
  countMemoryRows,
  deleteMemoryRow,
  formatTagsForEmbedding,
  getMemoryRow,
  insertMemoryRowsInOneTransaction,
} from "./storage/memory/rows.js";
import type { MemoryRecord } from "./storage/memory/types.js";
import { stripPrivateContent, isFullyPrivate } from "./privacy.js";
import { log } from "./logger.js";

function getPluginVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

export interface ExportMemoriesOptions {
  currentDirectory: string;
  outputPath: string;
}

export interface ExportMemoriesResult {
  success: boolean;
  outputPath?: string;
  count?: number;
  containerTag?: string;
  scopeHash?: string;
  error?: string;
}

export interface ImportMemoriesOptions {
  currentDirectory: string;
  inputPath: string;
  dryRun?: boolean;
}

export interface ImportMemoriesResult {
  success: boolean;
  dryRun: boolean;
  imported?: number;
  skipped?: Array<{ id: string; reason: string }>;
  rejected?: Array<{ id: string; reason: string }>;
  containerTag?: string;
  error?: string;
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function parseTags(value: unknown): string[] | undefined {
  if (!value || typeof value !== "string") return undefined;
  const tags = value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function rowToExportedMemory(row: Record<string, unknown>): ExportedMemory | null {
  const content = stripPrivateContent(String(row.content ?? ""));
  if (!content.trim() || isFullyPrivate(String(row.content ?? ""))) {
    return null;
  }

  return {
    id: String(row.id),
    content,
    type: row.type ? String(row.type) : undefined,
    tags: parseTags(row.tags),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at ?? row.created_at),
    isPinned: Number(row.is_pinned ?? 0) === 1,
    metadata: parseMetadata(row.metadata),
    displayName: row.display_name ? String(row.display_name) : undefined,
    userName: row.user_name ? String(row.user_name) : undefined,
    userEmail: row.user_email ? String(row.user_email) : undefined,
    projectPath: row.project_path ? String(row.project_path) : undefined,
    projectName: row.project_name ? String(row.project_name) : undefined,
    gitRepoUrl: row.git_repo_url ? String(row.git_repo_url) : undefined,
  };
}

export class MemoryPortabilityService {
  async exportMemories(options: ExportMemoriesOptions): Promise<ExportMemoriesResult> {
    await ensureMemoryStoreReady();

    const outputPath = resolve(options.outputPath);
    const project = getProjectTagInfo(options.currentDirectory);
    const { hash: scopeHash } = extractScopeFromContainerTag(project.tag);
    const shards = await listMemoryShards("project", scopeHash);

    const memories: ExportedMemory[] = [];
    for (const shard of shards) {
      if (!existsSync(shard.dbPath)) continue;
      // An export keeps every kind, memorisations included.
      const rows = await allMemoryRows(shard, "all");
      for (const row of rows) {
        const exported = rowToExportedMemory(row);
        if (exported) memories.push(exported);
      }
    }

    memories.sort((a, b) => b.createdAt - a.createdAt);

    const document: MemoryExportDocument = {
      schemaVersion: PORTABILITY_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      plugin: {
        package: "omms",
        version: getPluginVersion(),
      },
      source: {
        containerTag: project.tag,
        scope: "project",
        scopeHash,
        projectPath: project.projectPath,
        projectName: project.projectName,
        gitRepoUrl: project.gitRepoUrl,
      },
      embedding: {
        model: getEmbeddingModel(),
        dimensions: getEmbeddingDimensions(),
      },
      memories,
    };

    // Validate before writing so we never emit invalid documents.
    MemoryExportDocumentSchema.parse(document);

    mkdirSync(dirname(outputPath), { recursive: true });
    const tmpPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tmpPath, JSON.stringify(document, null, 2), "utf-8");
      renameSync(tmpPath, outputPath);
    } catch (error) {
      if (existsSync(tmpPath)) {
        try {
          unlinkSync(tmpPath);
        } catch {
          // ignore cleanup errors
        }
      }
      throw error;
    }

    return {
      success: true,
      outputPath,
      count: memories.length,
      containerTag: project.tag,
      scopeHash,
    };
  }

  async importMemories(options: ImportMemoriesOptions): Promise<ImportMemoriesResult> {
    await ensureMemoryStoreReady();
    await embeddingService.warmup();

    const inputPath = resolve(options.inputPath);
    if (!existsSync(inputPath)) {
      return {
        success: false,
        dryRun: Boolean(options.dryRun),
        error: `Import file not found: ${inputPath}`,
      };
    }

    if (statSync(inputPath).size > MAX_IMPORT_BYTES) {
      return {
        success: false,
        dryRun: Boolean(options.dryRun),
        error: `Import file exceeds ${MAX_IMPORT_BYTES} byte limit`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(inputPath, "utf-8"));
    } catch (error) {
      return {
        success: false,
        dryRun: Boolean(options.dryRun),
        error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "schemaVersion" in parsed &&
      typeof (parsed as { schemaVersion: unknown }).schemaVersion === "number" &&
      (parsed as { schemaVersion: number }).schemaVersion > PORTABILITY_SCHEMA_VERSION
    ) {
      return {
        success: false,
        dryRun: Boolean(options.dryRun),
        error: `Unsupported export schemaVersion ${(parsed as { schemaVersion: number }).schemaVersion}. Upgrade omms to import this file.`,
      };
    }

    const validated = MemoryExportDocumentSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        success: false,
        dryRun: Boolean(options.dryRun),
        error: `Invalid export document: ${validated.error.issues.map((issue) => issue.message).join("; ")}`,
      };
    }

    const document = validated.data;
    const target = getProjectTagInfo(options.currentDirectory);
    const { scope, hash } = extractScopeFromContainerTag(target.tag);

    // Pre-scan for ID conflicts across all project shards of the target.
    const targetShards = await listMemoryShards(scope, hash);
    const rejected: Array<{ id: string; reason: string }> = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const memory of document.memories) {
      for (const shard of targetShards) {
        if (!existsSync(shard.dbPath)) continue;
        const existing = await getMemoryRow(shard, memory.id);
        if (existing) {
          rejected.push({
            id: memory.id,
            reason: "memory id already exists in target project",
          });
          break;
        }
      }
    }

    if (rejected.length > 0) {
      return {
        success: false,
        dryRun: Boolean(options.dryRun),
        imported: 0,
        rejected,
        containerTag: target.tag,
        error: `Import aborted: ${rejected.length} memory id(s) already exist in the target project`,
      };
    }

    if (options.dryRun) {
      return {
        success: true,
        dryRun: true,
        imported: document.memories.length,
        skipped,
        rejected,
        containerTag: target.tag,
      };
    }

    const releaseLock = acquireMemoryOperationLock("memory-import");
    const insertedIds: string[] = [];

    try {
      // Phase A: compute all embeddings before any DB write.
      const prepared: Array<{ record: MemoryRecord; isPinned: boolean }> = [];
      for (const memory of document.memories) {
        const tags = memory.tags ?? [];
        const vector = await embeddingService.embedWithTimeout(memory.content, {
          task: "document",
        });
        const tagsVector =
          tags.length > 0
            ? await embeddingService.embedWithTimeout(formatTagsForEmbedding(tags), {
                task: "document",
              })
            : undefined;

        const metadata = {
          ...(memory.metadata ?? {}),
          source: "import",
          importedAt: Date.now(),
          exportSchemaVersion: document.schemaVersion,
          originalContainerTag: document.source.containerTag,
          originalProjectPath: document.source.projectPath,
        };

        prepared.push({
          record: {
            id: memory.id,
            content: memory.content,
            vector,
            tagsVector,
            containerTag: target.tag,
            tags: tags.length > 0 ? tags.join(",") : undefined,
            type: memory.type,
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt ?? memory.createdAt,
            metadata: JSON.stringify(metadata),
            displayName: target.displayName,
            userName: memory.userName,
            userEmail: memory.userEmail,
            projectPath: target.projectPath,
            projectName: target.projectName,
            gitRepoUrl: target.gitRepoUrl,
          },
          isPinned: Boolean(memory.isPinned),
        });
      }

      // Phase B: single transactional write. Avoid getWriteShard() here because it
      // refuses writes while our own operation lock is held.
      await withMemoryScopeWriteLock(scope, hash, async () => {
        let shard = await getActiveMemoryShard(scope, hash);
        if (!shard) {
          shard = await createMemoryShard(scope, hash, 0);
        }

        await insertMemoryRowsInOneTransaction(shard, prepared, (id) => insertedIds.push(id));

        await setShardCount(shard.id, await countMemoryRows(shard));
      });

      log("Memory import completed", {
        imported: insertedIds.length,
        containerTag: target.tag,
      });

      return {
        success: true,
        dryRun: false,
        imported: insertedIds.length,
        skipped,
        rejected,
        containerTag: target.tag,
      };
    } catch (error) {
      // Best-effort cleanup if a partial insert somehow escaped the transaction.
      if (insertedIds.length > 0) {
        try {
          const shards = await listMemoryShards(scope, hash);
          for (const shard of shards) {
            for (const id of insertedIds) {
              const existing = await getMemoryRow(shard, id);
              if (existing) {
                await deleteMemoryRow(shard, id);
              }
            }
            await setShardCount(shard.id, await countMemoryRows(shard));
          }
        } catch (cleanupError) {
          log("Memory import cleanup failed", { error: String(cleanupError) }, "error");
        }
      }

      return {
        success: false,
        dryRun: false,
        imported: 0,
        error: error instanceof Error ? error.message : String(error),
        containerTag: target.tag,
      };
    } finally {
      releaseLock();
    }
  }
}

export const memoryPortabilityService = new MemoryPortabilityService();
