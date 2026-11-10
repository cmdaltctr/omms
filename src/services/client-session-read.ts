import { extractScopeFromContainerTag } from "./memory-scope.js";
import { tursoShardManager } from "./turso/shard-manager.js";
import { tursoVectorSearch } from "./turso/vector-search.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import type { MemoryKind } from "./memory-kind.js";

export async function searchMemoriesBySessionID(
  sessionID: string,
  containerTag: string,
  limit: number,
  kind: MemoryKind
) {
  const { scope, hash } = extractScopeFromContainerTag(containerTag);
  const shards = await tursoShardManager.getAllShards(scope, hash);
  if (shards.length === 0) return [];

  const allMemories: any[] = [];
  for (const shard of shards) {
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const memories = await tursoVectorSearch.getMemoriesBySessionID(db, sessionID, kind);
    allMemories.push(...memories);
  }
  allMemories.sort((a, b) => Number(b.created_at) - Number(a.created_at));
  return allMemories.slice(0, limit).map((row: any) => ({
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
}
