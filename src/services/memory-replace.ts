import { tursoConnectionManager } from "./turso/connection-manager.js";
import { tursoShardManager } from "./turso/shard-manager.js";
import { tursoVectorSearch } from "./turso/vector-search.js";
import type { MemoryRecord } from "./turso/types.js";

/**
 * Swaps the stored row that has `record.id` for `record`, in the shard that
 * holds it, in one transaction: a failed insert rolls the delete back, so the
 * old row survives. Returns false when no row has that ID. The caller embeds
 * first, so an embedding failure never reaches this point.
 */
export async function replaceMemoryRow(record: MemoryRecord): Promise<boolean> {
  const shards = [
    ...(await tursoShardManager.getAllShards("user", "")),
    ...(await tursoShardManager.getAllShards("project", "")),
  ];
  for (const shard of shards) {
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    if (!(await tursoVectorSearch.getMemoryById(db, record.id))) continue;
    await db.transaction("write", async (tx) => {
      await tx.execute({ sql: `DELETE FROM memories WHERE id = ?`, args: [record.id] });
      await tursoVectorSearch.insertVectorInTransaction(tx, record);
    });
    return true;
  }
  return false;
}
