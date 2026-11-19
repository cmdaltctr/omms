import {
  ensureMemoryStoreReady,
  listEveryMemoryShard,
  listMemoryShards,
} from "./storage/memory/shards.js";
import { allMemoryRows, listMemoryRows, memorisationIdsInShard } from "./storage/memory/rows.js";
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
    const shards = await listMemoryShards(tagScope, hash);
    for (const shard of shards) {
      const memories = await listMemoryRows(shard, tag, 10000);
      allMemories.push(...memories);
    }
  } else {
    // Walk both project and user shards, so user-scope memories are listed too.
    // The container_tag check stays as defence in depth. Memorisations are not
    // listed here: allMemoryRows returns normal memories unless told otherwise.
    for (const shard of await listEveryMemoryShard("project")) {
      const memories = await allMemoryRows(shard);
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
  await ensureMemoryStoreReady();
  const found: string[] = [];
  for (const shard of await listEveryMemoryShard("project")) {
    found.push(...(await memorisationIdsInShard(shard, ids)));
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
