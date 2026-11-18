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
  ensureTursoReady,
  formatTagsForEmbedding,
  tursoConnectionManager,
  tursoShardManager,
  tursoVectorSearch,
  type MemoryRecord,
} from "./shards.js";
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
    await ensureTursoReady();
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

    return tursoShardManager.withScopeWriteLock(scope, hash, async () => {
      const shard = await tursoShardManager.getWriteShard(scope, hash);

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
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      await tursoVectorSearch.insertVector(db, record);
      await tursoShardManager.incrementVectorCount(shard.id);
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
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const memory = await tursoVectorSearch.getMemoryById(db, id);
      if (memory) {
        if (cascade) {
          const metadata = safeJSONParse(memory.metadata);
          const linkedPromptId = metadata?.promptId;
          if (linkedPromptId) await userPromptManager.deletePrompt(linkedPromptId);
        }
        await tursoVectorSearch.deleteVector(db, id);
        await tursoShardManager.decrementVectorCount(shard.id);
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

export async function handleUpdateMemory(
  id: string,
  data: { content?: string; type?: MemoryType; tags?: string[] }
): Promise<ApiResponse<void>> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const refusal = await webUpdateRefusal(id, data);
    if (refusal) return { success: false, error: refusal };
    await embeddingService.warmup();

    // Find the existing memory first (read-only — no data modified yet)
    const shards = await getAllMemoryShards();
    let existingMemory = null;
    for (const shard of shards) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      existingMemory = await tursoVectorSearch.getMemoryById(db, id);
      if (existingMemory) break;
    }
    if (!existingMemory) return { success: false, error: "Memory not found" };

    // STEP 1: Generate new embeddings FIRST (safe — no data deleted yet)
    const newContent = data.content || String(existingMemory.content);
    const existingTags = existingMemory.tags ? String(existingMemory.tags) : "";
    const tags =
      data.tags || (existingTags ? existingTags.split(",").map((t: string) => t.trim()) : []);
    const vector = await embeddingService.embedWithTimeout(newContent, { task: "document" });
    let tagsVector: Float32Array | undefined = undefined;
    if (tags.length > 0) {
      tagsVector = await embeddingService.embedWithTimeout(formatTagsForEmbedding(tags), {
        task: "document",
      });
    }

    const text = (value: unknown) => (value ? String(value) : undefined);
    const record: MemoryRecord = {
      id,
      content: newContent,
      vector,
      tagsVector,
      containerTag: String(existingMemory.container_tag),
      tags: tags.length > 0 ? tags.join(",") : undefined,
      type: data.type || text(existingMemory.type),
      createdAt: Number(existingMemory.created_at),
      updatedAt: Date.now(),
      metadata: text(existingMemory.metadata),
      displayName: text(existingMemory.display_name),
      userName: text(existingMemory.user_name),
      userEmail: text(existingMemory.user_email),
      projectPath: text(existingMemory.project_path),
      projectName: text(existingMemory.project_name),
      gitRepoUrl: text(existingMemory.git_repo_url),
    };

    // STEP 2: Swap the row under the scope write lock, as every other memory write does.
    const { scope, hash } = extractScopeFromContainerTag(record.containerTag);
    const replaced = await tursoShardManager.withScopeWriteLock(scope, hash, () =>
      replaceMemoryRow(record)
    );
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
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const memory = await tursoVectorSearch.getMemoryById(db, id);
      if (memory) {
        await tursoVectorSearch.pinMemory(db, id);
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
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const memory = await tursoVectorSearch.getMemoryById(db, id);
      if (memory) {
        await tursoVectorSearch.unpinMemory(db, id);
        return { success: true };
      }
    }
    return { success: false, error: "Memory not found" };
  } catch (error) {
    log("handleUnpinMemory: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}
