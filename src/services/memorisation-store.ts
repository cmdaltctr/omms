import { matchesTagGroups, visibleTags } from "../core/memorisation.js";
import { activeOwner } from "./active-space-access.js";
import { readLinkedMemory, type LinkedSearchSettings, type ListedMemory } from "./linked-search.js";
import type { MemoryScope } from "./client.js";
import { extractScopeFromContainerTag } from "./memory-scope.js";
import { memoryClient } from "./client.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import { tursoShardManager } from "./turso/shard-manager.js";
import { tursoVectorSearch } from "./turso/vector-search.js";

export interface StoredMemorisation {
  id: string;
  content: string;
  createdAt: string;
  /** The labels: the stored tags without the fixed memorisation tag. */
  tags: string[];
  /** Set when the record lives in a linked, read-only space. */
  space?: string;
}

function toStored(row: Record<string, unknown>, space?: string): StoredMemorisation {
  const created = Number(row.created_at);
  return {
    id: String(row.id),
    content: String(row.content),
    createdAt: new Date(Number.isFinite(created) ? created : 0).toISOString(),
    tags: visibleTags(typeof row.tags === "string" ? row.tags.split(",") : []),
    ...(space ? { space } : {}),
  };
}

/** The active-space row with this ID, in any project, or null. */
async function findActiveRow(id: string): Promise<Record<string, unknown> | null> {
  await memoryClient.ensureStorageReady();
  const shards = [
    ...(await tursoShardManager.getAllShards("user", "")),
    ...(await tursoShardManager.getAllShards("project", "")),
  ];
  for (const shard of shards) {
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const row = await tursoVectorSearch.getMemoryById(db, id);
    if (row) return row;
  }
  return null;
}

/**
 * Looks a memorisation up by exact ID in the active space, then in the linked spaces. A
 * project tag narrows the lookup to that project; `null` matches any project, the rule
 * recall and bulk delete use.
 * The caller snapshots `linked` from CONFIG, so this module never imports it.
 */
export async function getMemorisationById(
  id: string,
  containerTag: string | null,
  linked: LinkedSearchSettings
): Promise<StoredMemorisation | null> {
  const row = await findActiveRow(id);
  if (
    row?.type === "memorisation" &&
    (containerTag === null || row.container_tag === containerTag)
  ) {
    return toStored(row);
  }
  const found = await readLinkedMemory(id, activeOwner(), linked, containerTag);
  return found?.row.type === "memorisation" ? toStored(found.row, found.name) : null;
}

/**
 * True when any project in the active or a linked space already uses this memorisation ID.
 * A new ID must be free everywhere, so this check ignores the project.
 */
export async function memorisationIdTaken(
  id: string,
  linked: LinkedSearchSettings
): Promise<boolean> {
  if ((await findActiveRow(id))?.type === "memorisation") return true;
  const found = await readLinkedMemory(id, activeOwner(), linked, null);
  return found?.row.type === "memorisation";
}

/** The newest session snapshot of one host session in the project, or null. */
export async function findSnapshotByHostSession(
  hostSessionId: string,
  containerTag: string
): Promise<{ id: string } | null> {
  await memoryClient.ensureStorageReady();
  const { scope, hash } = extractScopeFromContainerTag(containerTag);
  let newest: { id: string; createdAt: number } | null = null;
  for (const shard of await tursoShardManager.getAllShards(scope, hash)) {
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const row = await db.get(
      `SELECT id, created_at FROM memories
       WHERE type = 'memorisation'
         AND container_tag = ?
         AND json_extract(metadata, '$.memorisation') = 'snapshot'
         AND json_extract(metadata, '$.hostSessionId') = ?
       ORDER BY created_at DESC LIMIT 1`,
      [containerTag, hostSessionId]
    );
    if (row && (!newest || Number(row.created_at) > newest.createdAt)) {
      newest = { id: String(row.id), createdAt: Number(row.created_at) };
    }
  }
  return newest ? { id: newest.id } : null;
}

/** Far above any real project: a memorisation is capped in size and the user saves each on purpose. */
const READ_CEILING = 10_000;

/**
 * The project's memorisations that match every group in `tags` (a comma is AND, a bar is OR), newest first, in the active
 * space and its linked spaces. The tag filter runs before `limit`, so an old labelled
 * row is not pushed out by newer rows without the label.
 */
export async function listMemorisationsByTags(
  containerTag: string,
  tags: string[][],
  scope: MemoryScope,
  limit: number
): Promise<{ success: true; memories: ListedMemory[] } | { success: false; error: string }> {
  const result = await memoryClient.listMemories(containerTag, READ_CEILING, scope, {
    includeLinked: true,
    kind: "memorisation",
  });
  if (!result.success) return { success: false, error: result.error };
  const memories = result.memories
    .filter((memory) => matchesTagGroups(memory.tags, tags))
    // Own rows come first from the client, then linked rows. Callers want one timeline.
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
  return { success: true, memories };
}

export type MemorisationDeleteOutcome = "deleted" | "not-found" | "linked" | "not-memorisation";

/**
 * Deletes one memorisation from the active space. A project tag narrows the delete to that
 * project; `null` matches any project, the rule bulk delete uses. No row is "not-found".
 * A row of another type is kept ("not-memorisation"). A row that lives only in a linked,
 * read-only space is "linked" and is never touched.
 */
export async function deleteMemorisation(
  id: string,
  containerTag: string | null,
  linked: LinkedSearchSettings
): Promise<MemorisationDeleteOutcome> {
  await memoryClient.ensureStorageReady();
  const shards = [
    ...(await tursoShardManager.getAllShards("user", "")),
    ...(await tursoShardManager.getAllShards("project", "")),
  ];
  for (const shard of shards) {
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const row = await tursoVectorSearch.getMemoryById(db, id);
    if (!row || (containerTag !== null && row.container_tag !== containerTag)) continue;
    if (row.type !== "memorisation") return "not-memorisation";
    await tursoVectorSearch.deleteVector(db, id);
    await tursoShardManager.decrementVectorCount(shard.id);
    return "deleted";
  }
  const found = await readLinkedMemory(id, activeOwner(), linked, containerTag);
  return found?.row.type === "memorisation" ? "linked" : "not-found";
}
