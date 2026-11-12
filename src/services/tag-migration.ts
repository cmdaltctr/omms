/**
 * AI tag backfill for memories saved without tags. Moved out of api-handlers.ts,
 * which sits at its file-size ceiling. The caller passes the config, so this
 * module never imports CONFIG.
 */
import { embeddingService } from "./embedding.js";
import { tursoShardManager } from "./turso/shard-manager.js";
import { tursoVectorSearch } from "./turso/vector-search.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import { ensureTursoReady } from "./turso/ready.js";
import { formatTagsForEmbedding } from "./turso/vector-utils.js";
import { UNTAGGED_NORMAL_PREDICATE } from "./memory-kind.js";
import { log } from "./logger.js";
import { resettable } from "./spaces/store-handles.js";
import { providerErrorKind, type ProviderErrorKind } from "./ai/provider-error-kind.js";
import type { buildMemoryProviderConfig } from "./ai/provider-config.js";
import type { AIProviderType } from "./ai/session/session-types.js";

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type TagMigrationConfig = Parameters<typeof buildMemoryProviderConfig>[0] & {
  memoryProvider: AIProviderType;
};

/**
 * One batch's answer. `error` and `errorKind` describe the failure that stopped the run,
 * or else the first failure of the run.
 */
export interface TagMigrationBatch {
  processed: number;
  total: number;
  hasMore: boolean;
  tagged: number;
  failed: number;
  errorKind?: ProviderErrorKind;
  error?: string;
}

interface MigrationProgress {
  processed: number;
  total: number;
  currentBatch: number;
  totalBatches: number;
  isComplete: boolean;
  tagged: number;
  errors: string[];
  errorKind?: ProviderErrorKind;
}

const idleMigration = (): MigrationProgress => ({
  processed: 0,
  total: 0,
  currentBatch: 0,
  totalBatches: 0,
  isComplete: true,
  tagged: 0,
  errors: [],
});

let migrationProgress: MigrationProgress = idleMigration();
/** The untagged memories this migration run covers, fixed when the run starts. */
let migrationQueue: Array<{ id: string; dbPath: string }> = [];
/** Goes up on a memory space switch, so a batch still running for the old space stops. */
let spaceGeneration = 0;
/** The batch now running. Batches run one at a time, so two never take the same memories. */
let batchInFlight: Promise<unknown> = Promise.resolve();

// The queue holds paths in the active space, so a space switch drops the run.
// The next batch then builds a new queue for the new space.
resettable("tag-migration", null, () => {
  spaceGeneration++;
  migrationProgress = idleMigration();
});

/** The longest error text sent to the page. */
const ERROR_TEXT_LIMIT = 300;

export async function handleDetectTagMigration(): Promise<
  ApiResponse<{ needsMigration: boolean; count: number }>
> {
  try {
    await ensureTursoReady();
    let untaggedCount = 0;
    for (const shard of await tursoShardManager.getAllShards("project", "")) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const row = await db.get(
        `SELECT COUNT(*) as count FROM memories WHERE ${UNTAGGED_NORMAL_PREDICATE}`
      );
      untaggedCount += Number(row?.count ?? 0);
    }
    return { success: true, data: { needsMigration: untaggedCount > 0, count: untaggedCount } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function handleGetTagMigrationProgress(): Promise<ApiResponse<MigrationProgress>> {
  return { success: true, data: migrationProgress };
}

/** The error as the page may show it: short, and with the API key removed. */
function pageErrorText(error: unknown, apiKey: string | undefined): string {
  let text = error instanceof Error ? error.message : String(error);
  if (apiKey) text = text.split(apiKey).join("[redacted]");
  return text.length > ERROR_TEXT_LIMIT ? `${text.slice(0, ERROR_TEXT_LIMIT)}…` : text;
}

/**
 * Tag the memories that have no tags, a few per request. Only untagged
 * memories are touched: tagged ones keep their vectors. A memory that fails
 * is recorded and passed over, so one bad row cannot stall the run. An error
 * that fails every memory the same way (no credit, a rejected key) ends the
 * run at once, so a later run starts over with every untagged memory.
 */
export function runTagMigrationBatch(
  config: TagMigrationConfig,
  batchSize: number = 5
): Promise<ApiResponse<TagMigrationBatch>> {
  const run = batchInFlight.then(() => runOneBatch(config, batchSize));
  batchInFlight = run.catch(() => undefined);
  return run;
}

async function runOneBatch(
  config: TagMigrationConfig,
  batchSize: number
): Promise<ApiResponse<TagMigrationBatch>> {
  const generation = spaceGeneration;
  try {
    await ensureTursoReady();
    const { AIProviderFactory } = await import("./ai/ai-provider-factory.js");
    const { buildMemoryProviderConfig } = await import("./ai/provider-config.js");
    const providerConfig = buildMemoryProviderConfig(config, {
      maxIterations: 1,
      iterationTimeout: 30000,
    });
    const provider = AIProviderFactory.createProvider(config.memoryProvider, providerConfig);

    if (migrationProgress.isComplete) {
      migrationQueue = [];
      for (const shard of await tursoShardManager.getAllShards("project", "")) {
        const db = await tursoConnectionManager.getConnection(shard.dbPath);
        const rows = await db.all(
          `SELECT id FROM memories WHERE ${UNTAGGED_NORMAL_PREDICATE} ORDER BY id`
        );
        for (const row of rows) migrationQueue.push({ id: String(row.id), dbPath: shard.dbPath });
      }
      migrationProgress = {
        ...idleMigration(),
        total: migrationQueue.length,
        totalBatches: Math.ceil(migrationQueue.length / batchSize),
        isComplete: migrationQueue.length === 0,
      };
    }

    const batch = migrationQueue.slice(
      migrationProgress.processed,
      migrationProgress.processed + batchSize
    );
    let stopped = false;
    for (const item of batch) {
      if (generation !== spaceGeneration) {
        return { success: false, error: "The memory space changed during tagging" };
      }
      try {
        const db = await tursoConnectionManager.getConnection(item.dbPath);
        const m: any = await db.get("SELECT * FROM memories WHERE id = ?", [item.id]);
        // Tagged or deleted since the run started: nothing to do.
        if (!m || (m.tags && String(m.tags).trim())) continue;
        const prompt = `Generate 2-4 short technical tags for this memory content:\n\n${m.content}\n\nReturn ONLY a comma-separated list of tags.`;
        const result = await provider.executeToolCall(
          "You are a technical tagger.",
          prompt,
          {
            type: "function",
            function: {
              name: "save_tags",
              description: "Save generated tags",
              parameters: {
                type: "object",
                properties: { tags: { type: "array", items: { type: "string" } } },
                required: ["tags"],
              },
            },
          },
          `migration_${m.id}`
        );
        const tags: string[] = Array.isArray(result.data?.tags)
          ? result.data.tags.map((t: unknown) => String(t).trim().toLowerCase()).filter(Boolean)
          : [];
        if (!result.success || tags.length === 0) {
          throw new Error(result.error ?? "The model returned no tags");
        }
        const vector = await embeddingService.embedWithTimeout(m.content, { task: "document" });
        const tagsVector = await embeddingService.embedWithTimeout(formatTagsForEmbedding(tags), {
          task: "document",
        });
        // One statement, so a memory never ends up tagged with stale vectors.
        await tursoVectorSearch.updateVector(db, m.id, vector, tagsVector, tags.join(","));
        migrationProgress.tagged++;
      } catch (e) {
        const errorMsg = pageErrorText(e, config.memoryApiKey);
        const kind = providerErrorKind(errorMsg);
        log("Migration error for memory", { id: item.id, error: errorMsg, kind }, "error");
        if (kind === "other") {
          migrationProgress.errors.push(errorMsg);
          migrationProgress.errorKind ??= kind;
        } else {
          // This error ends the run, so it is the one the page reports.
          migrationProgress.errors.unshift(errorMsg);
          migrationProgress.errorKind = kind;
          stopped = true;
        }
      } finally {
        migrationProgress.processed++;
      }
      if (stopped) break;
    }

    migrationProgress.currentBatch++;
    const hasMore = !stopped && migrationProgress.processed < migrationProgress.total;
    if (!hasMore) migrationProgress.isComplete = true;

    const { processed, total, tagged, errors, errorKind } = migrationProgress;
    return {
      success: true,
      data: {
        processed,
        total,
        hasMore,
        tagged,
        failed: errors.length,
        ...(errors.length > 0 ? { errorKind, error: errors[0] } : {}),
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
