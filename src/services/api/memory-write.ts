import { embeddingService } from "../embedding.js";
import { extractScopeFromContainerTag } from "../memory-scope.js";
import { log } from "../logger.js";
import type { MemoryType } from "../../types/index.js";
import { userPromptManager } from "../user-prompt/user-prompt-manager.js";
import { replaceMemoryRow } from "../memory-replace.js";
import {
  memorisationIdsAmong,
  MEMORISATION_EDIT_REFUSAL,
  MEMORISATION_TYPE_REFUSAL,
  webUpdateRefusal,
} from "../web-memory-rows.js";
import {
  deleteMemoryRow,
  formatTagsForEmbedding,
  getMemoryRow,
  insertMemoryRow,
  pinMemoryRow,
  unpinMemoryRow,
} from "../storage/memory/rows.js";
import {
  decrementShardCount,
  ensureMemoryStoreReady,
  getWriteMemoryShard,
  incrementShardCount,
  withMemoryScopeWriteLock,
} from "../storage/memory/shards.js";
import type { MemoryRecord, MemoryRow } from "../storage/memory/types.js";
import {
  extractScopeFromTag,
  getAllMemoryShards,
  safeJSONParse,
  type ApiResponse,
} from "./shared.js";

export async function handleAddMemory(data: {
  content: string;
  containerTag: string;
  type?: MemoryType;
  tags?: string[];
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}): Promise<ApiResponse<{ id: string }>> {
  try {
    if (!data.content || !data.containerTag) {
      return { success: false, error: "content and containerTag are required" };
    }
    if (data.type === "memorisation") return { success: false, error: MEMORISATION_TYPE_REFUSAL };
    await ensureMemoryStoreReady();
    await embeddingService.warmup();
    const tags = (data.tags || []).map((t) => t.trim().toLowerCase());
    const embeddingInput =
      tags.length > 0 ? `${data.content}\nTags: ${tags.join(", ")}` : data.content;

    const vector = await embeddingService.embedWithTimeout(embeddingInput, { task: "document" });
    let tagsVector: Float32Array | undefined = undefined;
    if (tags.length > 0) {
      tagsVector = await embeddingService.embedWithTimeout(formatTagsForEmbedding(tags), {
        task: "document",
      });
    }

    const { scope, hash } = extractScopeFromTag(data.containerTag);

    // Await, so a failed insert reaches the catch below and returns a failed response.
    return await withMemoryScopeWriteLock(scope, hash, async () => {
      const shard = await getWriteMemoryShard(scope, hash);

      const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      const now = Date.now();

      const record = {
        id,
        content: data.content,
        vector,
        tagsVector,
        containerTag: data.containerTag,
        tags: tags.length > 0 ? tags.join(",") : undefined,
        type: data.type,
        createdAt: now,
        updatedAt: now,
        displayName: data.displayName,
        userName: data.userName,
        userEmail: data.userEmail,
        projectPath: data.projectPath,
        projectName: data.projectName,
        gitRepoUrl: data.gitRepoUrl,
        metadata: JSON.stringify({ source: "api" }),
      };
      await insertMemoryRow(shard, record);
      await incrementShardCount(shard.id);
      return { success: true as const, data: { id } };
    });
  } catch (error) {
    log("handleAddMemory: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleDeleteMemory(
  id: string,
  cascade: boolean = false
): Promise<ApiResponse<{ deletedPrompt: boolean }>> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const shards = await getAllMemoryShards();
    for (const shard of shards) {
      const memory = await getMemoryRow(shard, id);
      if (memory) {
        if (cascade) {
          const metadata = safeJSONParse(memory.metadata);
          const linkedPromptId = metadata?.promptId;
          if (linkedPromptId) await userPromptManager.deletePrompt(linkedPromptId);
        }
        if (await deleteMemoryRow(shard, id)) await decrementShardCount(shard.id);
        return {
          success: true,
          data: { deletedPrompt: cascade && !!safeJSONParse(memory.metadata)?.promptId },
        };
      }
    }
    return { success: false, error: "Memory not found" };
  } catch (error) {
    log("handleDeleteMemory: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleBulkDelete(
  ids: string[],
  cascade: boolean = false
): Promise<ApiResponse<{ deleted: number }>> {
  try {
    if (!ids || ids.length === 0) return { success: false, error: "ids array is required" };
    if ((await memorisationIdsAmong(ids)).length > 0) {
      return { success: false, error: MEMORISATION_EDIT_REFUSAL };
    }
    let deleted = 0;
    for (const id of ids) {
      const result = await handleDeleteMemory(id, cascade);
      if (result.success) deleted++;
    }
    return { success: true, data: { deleted } };
  } catch (error) {
    log("handleBulkDelete: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

type MemoryUpdate = { content?: string; type?: MemoryType; tags?: string[] };

async function findMemoryRow(id: string): Promise<MemoryRow | null> {
  for (const shard of await getAllMemoryShards()) {
    const row = await getMemoryRow(shard, id);
    if (row) return row;
  }
  return null;
}

/** The request's fields over the stored row, with embeddings for the resulting text. */
async function updatedRecord(
  row: MemoryRow,
  data: MemoryUpdate,
  embed: (input: string) => Promise<Float32Array>
): Promise<MemoryRecord> {
  const content = data.content || String(row.content);
  const storedTags = row.tags ? String(row.tags) : "";
  const tags = data.tags || (storedTags ? storedTags.split(",").map((t: string) => t.trim()) : []);
  const text = (value: unknown) => (value ? String(value) : undefined);
  return {
    id: String(row.id),
    content,
    vector: await embed(content),
    tagsVector: tags.length > 0 ? await embed(formatTagsForEmbedding(tags)) : undefined,
    containerTag: String(row.container_tag),
    tags: tags.length > 0 ? tags.join(",") : undefined,
    type: data.type || text(row.type),
    createdAt: Number(row.created_at),
    updatedAt: Date.now(),
    metadata: text(row.metadata),
    displayName: text(row.display_name),
    userName: text(row.user_name),
    userEmail: text(row.user_email),
    projectPath: text(row.project_path),
    projectName: text(row.project_name),
    gitRepoUrl: text(row.git_repo_url),
  };
}

export async function handleUpdateMemory(
  id: string,
  data: MemoryUpdate
): Promise<ApiResponse<void>> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const refusal = await webUpdateRefusal(id, data);
    if (refusal) return { success: false, error: refusal };
    await embeddingService.warmup();

    const existingMemory = await findMemoryRow(id);
    if (!existingMemory) return { success: false, error: "Memory not found" };

    // STEP 1: Embed before the lock, so a slow model call never holds it (TDR 081).
    const embedded = new Map<string, Promise<Float32Array>>();
    const embed = (input: string) => {
      if (!embedded.has(input)) {
        embedded.set(input, embeddingService.embedWithTimeout(input, { task: "document" }));
      }
      return embedded.get(input)!;
    };
    const record = await updatedRecord(existingMemory, data, embed);

    // STEP 2: Under the scope write lock, read the row again and merge onto it, so a field
    // this edit did not send keeps a value another edit wrote meanwhile. The embeddings
    // above are reused; only text that another edit changed is embedded again.
    const { scope, hash } = extractScopeFromContainerTag(record.containerTag);
    const replaced = await withMemoryScopeWriteLock(scope, hash, async () => {
      const current = await findMemoryRow(id);
      return current ? replaceMemoryRow(await updatedRecord(current, data, embed)) : false;
    });
    return replaced ? { success: true } : { success: false, error: "Memory not found" };
  } catch (error) {
    log("handleUpdateMemory: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handlePinMemory(id: string): Promise<ApiResponse<void>> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const shards = await getAllMemoryShards();
    for (const shard of shards) {
      const memory = await getMemoryRow(shard, id);
      if (memory) {
        await pinMemoryRow(shard, id);
        return { success: true };
      }
    }
    return { success: false, error: "Memory not found" };
  } catch (error) {
    log("handlePinMemory: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleUnpinMemory(id: string): Promise<ApiResponse<void>> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const shards = await getAllMemoryShards();
    for (const shard of shards) {
      const memory = await getMemoryRow(shard, id);
      if (memory) {
        await unpinMemoryRow(shard, id);
        return { success: true };
      }
    }
    return { success: false, error: "Memory not found" };
  } catch (error) {
    log("handleUnpinMemory: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}
