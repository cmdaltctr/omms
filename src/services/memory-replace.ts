import { listEveryMemoryShard } from "./storage/memory/shards.js";
import { getMemoryRow, replaceMemoryRowInShard } from "./storage/memory/rows.js";
import type { MemoryRecord } from "./storage/memory/types.js";

/**
 * Swaps the stored row that has `record.id` for `record`, in the shard that
 * holds it, in one transaction: a failed insert rolls the delete back, so the
 * old row survives. Returns false when no row has that ID. The caller embeds
 * first, so an embedding failure never reaches this point.
 */
export async function replaceMemoryRow(record: MemoryRecord): Promise<boolean> {
  // User shards first, then project shards: the first shard that holds the ID wins.
  for (const shard of await listEveryMemoryShard("user")) {
    const existing = await getMemoryRow(shard, record.id);
    if (!existing) continue;
    // The caller builds a fresh record, so the replaced row's pin is carried over here.
    const kept = { ...record, isPinned: Number(existing.is_pinned) === 1 };
    await replaceMemoryRowInShard(shard, kept);
    return true;
  }
  return false;
}
