import { tursoShardManager } from "./turso/shard-manager.js";
import { tursoVectorSearch } from "./turso/vector-search.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import { ensureTursoReady } from "./turso/ready.js";
import { extractScopeFromContainerTag } from "./memory-scope.js";

/** Why the Memories page cannot edit a memorisation. */
export const MEMORISATION_EDIT_REFUSAL =
  "A memorisation cannot be edited or bulk deleted from the Memories page. Delete it on the Memorisation page, or replace it by memorising again.";

/** Why the Memories page cannot create a memorisation. */
export const MEMORISATION_TYPE_REFUSAL =
  "The memorisation type is reserved. Save a memorisation with the memorise operation, not from the Memories page.";

/** Reads stored normal memory rows for one project tag, or for every project and user shard. */
export async function loadMemoryRows(tag?: string): Promise<any[]> {
  const allMemories: any[] = [];
  if (tag) {
    const { scope: tagScope, hash } = extractScopeFromContainerTag(tag);
    const shards = await tursoShardManager.getAllShards(tagScope, hash);
    for (const shard of shards) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const memories = await tursoVectorSearch.listMemories(db, tag, 10000);
      allMemories.push(...memories);
    }
  } else {
    // Walk both project and user shards, so user-scope memories are listed too.
    // The container_tag check stays as defence in depth. Memorisations are not
    // listed here: getAllMemories returns normal memories unless told otherwise.
    const projectShards = await tursoShardManager.getAllShards("project", "");
    const userShards = await tursoShardManager.getAllShards("user", "");
    for (const shard of [...projectShards, ...userShards]) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const memories = await tursoVectorSearch.getAllMemories(db);
      allMemories.push(
        ...memories.filter(
          (m: any) => m.container_tag?.includes("_project_") || m.container_tag?.includes("_user_")
        )
      );
    }
  }
  return allMemories;
}

/** The IDs among `ids` whose stored row is a memorisation, across every project and user shard. */
export async function memorisationIdsAmong(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  await ensureTursoReady();
  const shards = [
    ...(await tursoShardManager.getAllShards("project", "")),
    ...(await tursoShardManager.getAllShards("user", "")),
  ];
  const found: string[] = [];
  for (const shard of shards) {
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const rows = await db.all(
      `SELECT id FROM memories WHERE type = 'memorisation' AND id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    found.push(...rows.map((row) => String(row.id)));
  }
  return found;
}

/** The refusal for a web edit of memory `id` with `data`, or undefined when the edit is allowed. */
export async function webUpdateRefusal(
  id: string,
  data: { type?: string }
): Promise<string | undefined> {
  if (data.type === "memorisation") return MEMORISATION_TYPE_REFUSAL;
  return (await memorisationIdsAmong([id])).length > 0 ? MEMORISATION_EDIT_REFUSAL : undefined;
}
