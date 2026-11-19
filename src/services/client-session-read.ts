import { extractScopeFromContainerTag } from "./memory-scope.js";
import { listMemoryShards } from "./storage/memory/shards.js";
import { sessionMemoryRows } from "./storage/memory/rows.js";
import type { MemoryKind } from "./memory-kind.js";

export async function searchMemoriesBySessionID(
  sessionID: string,
  containerTag: string,
  limit: number,
  kind: MemoryKind
) {
  const { scope, hash } = extractScopeFromContainerTag(containerTag);
  const shards = await listMemoryShards(scope, hash);
  if (shards.length === 0) return [];

  const allMemories: any[] = [];
  for (const shard of shards) {
    const memories = await sessionMemoryRows(shard, sessionID, kind);
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
