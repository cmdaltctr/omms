import { log } from "../logger.js";
import { countKeywords, type KeywordCount } from "../keyword-counts.js";
import { loadMemoryRows } from "../web-memory-rows.js";
import {
  ensureTursoReady,
  tursoConnectionManager,
  tursoShardManager,
  tursoVectorSearch,
} from "./shards.js";
import { getAllMemoryShards, type ApiResponse } from "./shared.js";

interface TagInfo {
  tag: string;
  tags?: string[];
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

export async function handleListTags(): Promise<ApiResponse<{ project: TagInfo[] }>> {
  try {
    await ensureTursoReady();
    // Tags are stored as SQLite metadata; embedding model is not needed.
    // Calling warmup() here would block on local transformer init in the worker
    // thread and hang every read API. Only handlers that compute similarity
    // (e.g. handleSearch) should warm up the embedding service.
    const projectShards = await tursoShardManager.getAllShards("project", "");
    const tagsMap = new Map<string, TagInfo>();
    for (const shard of projectShards) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const tags = await tursoVectorSearch.getDistinctTags(db);
      for (const t of tags) {
        if (t.container_tag && !tagsMap.has(String(t.container_tag))) {
          tagsMap.set(String(t.container_tag), {
            tag: String(t.container_tag),
            displayName: t.display_name ? String(t.display_name) : undefined,
            userName: t.user_name ? String(t.user_name) : undefined,
            userEmail: t.user_email ? String(t.user_email) : undefined,
            projectPath: t.project_path ? String(t.project_path) : undefined,
            projectName: t.project_name ? String(t.project_name) : undefined,
            gitRepoUrl: t.git_repo_url ? String(t.git_repo_url) : undefined,
          });
        }
      }
    }
    const projectTags: TagInfo[] = [];
    for (const tagInfo of tagsMap.values()) {
      if (tagInfo.tag.includes("_project_")) {
        projectTags.push(tagInfo);
      }
    }
    return { success: true, data: { project: projectTags } };
  } catch (error) {
    log("handleListTags: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

/** Labels (comma-separated memory tags) with how many memories carry each one. */
export async function handleListKeywords(
  tag?: string
): Promise<ApiResponse<{ keywords: KeywordCount[] }>> {
  try {
    await ensureTursoReady();
    const rows = await loadMemoryRows(tag);
    return { success: true, data: { keywords: countKeywords(rows.map((r) => r.tags)) } };
  } catch (error) {
    log("handleListKeywords: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleStats(): Promise<
  ApiResponse<{
    total: number;
    byScope: { user: number; project: number };
    byType: Record<string, number>;
  }>
> {
  try {
    // Stats only counts Turso/libSQL rows; no embedding needed.
    // See handleListTags comment - keep embedding init out of read paths.
    const shards = await getAllMemoryShards();
    let userCount = 0,
      projectCount = 0;
    const typeCount: Record<string, number> = {};
    for (const shard of shards) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const memories = await tursoVectorSearch.getAllMemories(db);
      for (const r of memories) {
        const containerTag = String(r.container_tag ?? "");
        const type = r.type ? String(r.type) : "";
        if (containerTag.includes("_user_")) userCount++;
        else if (containerTag.includes("_project_")) projectCount++;
        if (type) typeCount[type] = (typeCount[type] || 0) + 1;
      }
    }
    return {
      success: true,
      data: {
        total: userCount + projectCount,
        byScope: { user: userCount, project: projectCount },
        byType: typeCount,
      },
    };
  } catch (error) {
    log("handleStats: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}
