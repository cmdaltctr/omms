import { embeddingService } from "../embedding.js";
import { tryExtractScopeFromContainerTag } from "../memory-scope.js";
import { log } from "../logger.js";
import { userPromptManager } from "../user-prompt/user-prompt-manager.js";
import { distinctMemoryTags, getMemoryRow } from "../storage/memory/rows.js";
import { searchMemoryShard } from "../storage/memory/search.js";
import { ensureMemoryStoreReady, listMemoryShards } from "../storage/memory/shards.js";
import {
  extractScopeFromTag,
  getAllMemoryShards,
  getProjectPathFromTag,
  safeJSONParse,
  safeToISOString,
  type ApiResponse,
  type PaginatedResponse,
} from "./shared.js";

interface FormattedPrompt {
  type: "prompt";
  id: string;
  sessionId: string;
  content: string;
  createdAt: string;
  projectPath: string | null;
  linkedMemoryId: string | null;
  similarity?: number;
  isContext?: boolean;
}

interface FormattedMemory {
  type: "memory";
  id: string;
  content: string;
  memoryType?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
  linkedPromptId?: string;
  isContext?: boolean;
}

type SearchResultItem = FormattedPrompt | FormattedMemory;

export async function handleSearch(
  query: string,
  tag?: string,
  page: number = 1,
  pageSize: number = 20
): Promise<ApiResponse<PaginatedResponse<SearchResultItem>>> {
  try {
    if (!query) return { success: false, error: "query is required" };
    await ensureMemoryStoreReady();
    await embeddingService.warmup();
    const queryVector = await embeddingService.embedWithTimeout(query, { task: "query" });
    const memoryResults: any[] = [];
    let promptResults: any[] = [];
    if (tag) {
      const { scope, hash } = extractScopeFromTag(tag);
      const shards = await listMemoryShards(scope, hash);
      for (const shard of shards) {
        try {
          const results = await searchMemoryShard(shard, queryVector, tag, pageSize * 2);
          memoryResults.push(...results);
        } catch (error) {
          log("Shard search error", { shardId: shard.id, error: String(error) }, "error");
        }
      }
      const projectPath = await getProjectPathFromTag(tag);
      promptResults = await userPromptManager.searchPrompts(query, projectPath, pageSize * 2);
    } else {
      const allShards = await getAllMemoryShards();
      const uniqueTags = new Set<string>();
      for (const shard of allShards) {
        const tags = await distinctMemoryTags(shard);
        for (const t of tags) {
          if (t.container_tag) uniqueTags.add(String(t.container_tag));
        }
      }
      for (const containerTag of uniqueTags) {
        const parsed = tryExtractScopeFromContainerTag(containerTag);
        if (!parsed) {
          log("Skipping invalid container_tag during global search", { containerTag }, "warn");
          continue;
        }
        const { scope, hash } = parsed;
        const shards = await listMemoryShards(scope, hash);
        for (const shard of shards) {
          try {
            const results = await searchMemoryShard(shard, queryVector, containerTag, pageSize);
            memoryResults.push(...results);
          } catch (error) {
            log("Shard search error", { shardId: shard.id, error: String(error) }, "error");
          }
        }
      }
      promptResults = await userPromptManager.searchPrompts(query, undefined, pageSize * 2);
    }

    const formattedPrompts: FormattedPrompt[] = promptResults.map((p) => ({
      type: "prompt",
      id: p.id,
      sessionId: p.sessionId,
      content: p.content,
      createdAt: safeToISOString(p.createdAt),
      projectPath: p.projectPath,
      linkedMemoryId: p.linkedMemoryId,
      similarity: 1.0,
    }));

    const formattedMemories: FormattedMemory[] = memoryResults.map((r: any) => ({
      type: "memory",
      id: r.id,
      content: r.memory,
      memoryType: r.type ?? r.metadata?.type,
      tags: r.tags,
      createdAt: safeToISOString(r.createdAt ?? r.metadata?.createdAt),
      updatedAt: r.metadata?.updatedAt ? safeToISOString(r.metadata.updatedAt) : undefined,
      similarity: r.similarity,
      metadata: r.metadata,
      displayName: r.displayName,
      userName: r.userName,
      userEmail: r.userEmail,
      projectPath: r.projectPath,
      projectName: r.projectName,
      gitRepoUrl: r.gitRepoUrl,
      isPinned: r.isPinned === 1,
      linkedPromptId: r.metadata?.promptId,
    }));

    const combinedResults = [...formattedMemories, ...formattedPrompts].sort(
      (a: any, b: any) =>
        (b.similarity || 0) - (a.similarity || 0) || b.createdAt.localeCompare(a.createdAt)
    );

    const total = combinedResults.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const paginatedResults: SearchResultItem[] = combinedResults.slice(offset, offset + pageSize);

    const missingPromptIds = new Set<string>();
    const missingMemoryIds = new Set<string>();
    for (const item of paginatedResults) {
      if (item.type === "memory" && item.linkedPromptId) {
        if (!paginatedResults.some((p) => p.id === item.linkedPromptId))
          missingPromptIds.add(item.linkedPromptId);
      } else if (item.type === "prompt" && item.linkedMemoryId) {
        if (!paginatedResults.some((m) => m.id === item.linkedMemoryId))
          missingMemoryIds.add(item.linkedMemoryId);
      }
    }

    if (missingPromptIds.size > 0) {
      const extraPrompts = await userPromptManager.getPromptsByIds(Array.from(missingPromptIds));
      for (const p of extraPrompts) {
        paginatedResults.push({
          type: "prompt",
          id: p.id,
          sessionId: p.sessionId,
          content: p.content,
          createdAt: safeToISOString(p.createdAt),
          projectPath: p.projectPath,
          linkedMemoryId: p.linkedMemoryId,
          similarity: 0,
          isContext: true,
        });
      }
    }

    if (missingMemoryIds.size > 0) {
      const shards = await getAllMemoryShards();
      for (const shard of shards) {
        for (const mid of missingMemoryIds) {
          const m = await getMemoryRow(shard, mid);
          if (m && !paginatedResults.some((existing) => existing.id === m.id)) {
            paginatedResults.push({
              type: "memory",
              id: String(m.id),
              content: String(m.content),
              memoryType: m.type ? String(m.type) : undefined,
              tags: m.tags
                ? String(m.tags)
                    .split(",")
                    .map((t: string) => t.trim())
                : [],
              createdAt: safeToISOString(m.created_at),
              updatedAt: m.updated_at ? safeToISOString(m.updated_at) : undefined,
              similarity: 0,
              metadata: safeJSONParse(m.metadata),
              displayName: m.display_name ? String(m.display_name) : undefined,
              userName: m.user_name ? String(m.user_name) : undefined,
              userEmail: m.user_email ? String(m.user_email) : undefined,
              projectPath: m.project_path ? String(m.project_path) : undefined,
              projectName: m.project_name ? String(m.project_name) : undefined,
              gitRepoUrl: m.git_repo_url ? String(m.git_repo_url) : undefined,
              isPinned: Number(m.is_pinned) === 1,
              linkedPromptId: safeJSONParse(m.metadata)?.promptId,
              isContext: true,
            });
          }
        }
      }
    }

    return { success: true, data: { items: paginatedResults, total, page, pageSize, totalPages } };
  } catch (error) {
    log("handleSearch: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}
