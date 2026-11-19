import { tursoConnectionManager } from "../../turso/connection-manager.js";
import { tursoVectorSearch } from "../../turso/vector-search.js";
import { memoryKindPredicate, type MemoryKind } from "../../memory-kind.js";
import type { MemoryRecord, MemoryRow, ShardInfo, ShardOpener, StoreDb } from "./types.js";

// Pure helpers callers need beside the rows: tag text for the tags embedding, and the
// vector a dedup read extracts.
export { formatTagsForEmbedding, parseExtractedVector } from "../../turso/vector-utils.js";

/**
 * Rows of the `memories` table, keyed by shard. Each call opens the shard through the
 * engine's live connection pool (or through `open`, for a read-only linked space), so no
 * handle outlives the call. The SQL in this file moved here byte for byte from the callers
 * named on each function ("From ..."), which now call these functions instead.
 */

function openShard(shard: ShardInfo, open?: ShardOpener): Promise<StoreDb> {
  return open ? open(shard.dbPath) : tursoConnectionManager.getConnection(shard.dbPath);
}

/** The row with this ID in the shard, of any kind, or null. */
export async function getMemoryRow(shard: ShardInfo, memoryId: string): Promise<MemoryRow | null> {
  return tursoVectorSearch.getMemoryById(await openShard(shard), memoryId);
}

/** Inserts one memory row into the shard. The caller updates the shard count. */
export async function insertMemoryRow(shard: ShardInfo, record: MemoryRecord): Promise<void> {
  await tursoVectorSearch.insertVector(await openShard(shard), record);
}

/** Deletes the row with this ID from the shard. The caller updates the shard count. */
export async function deleteMemoryRow(shard: ShardInfo, memoryId: string): Promise<void> {
  await tursoVectorSearch.deleteVector(await openShard(shard), memoryId);
}

export async function pinMemoryRow(shard: ShardInfo, memoryId: string): Promise<void> {
  await tursoVectorSearch.pinMemory(await openShard(shard), memoryId);
}

export async function unpinMemoryRow(shard: ShardInfo, memoryId: string): Promise<void> {
  await tursoVectorSearch.unpinMemory(await openShard(shard), memoryId);
}

/** The newest rows of one kind, for one project tag or (with "") every tag. */
export async function listMemoryRows(
  shard: ShardInfo,
  containerTag: string,
  limit: number,
  kind?: MemoryKind,
  open?: ShardOpener
): Promise<MemoryRow[]> {
  return tursoVectorSearch.listMemories(await openShard(shard, open), containerTag, limit, kind);
}

/** Every row of one kind, newest first. Pass "all" only for kind-neutral readers such as export. */
export async function allMemoryRows(
  shard: ShardInfo,
  kind?: MemoryKind | "all"
): Promise<MemoryRow[]> {
  return tursoVectorSearch.getAllMemories(await openShard(shard), kind);
}

/** Each distinct project tag in the shard with its display fields. */
export async function distinctMemoryTags(shard: ShardInfo): Promise<MemoryRow[]> {
  return tursoVectorSearch.getDistinctTags(await openShard(shard));
}

/** How many rows the shard holds, of every kind. */
export async function countMemoryRows(shard: ShardInfo): Promise<number> {
  return tursoVectorSearch.countAllVectors(await openShard(shard));
}

/** The rows of one kind that one host session saved, newest first, with tags and metadata parsed. */
export async function sessionMemoryRows(
  shard: ShardInfo,
  sessionID: string,
  kind?: MemoryKind
): Promise<MemoryRow[]> {
  return tursoVectorSearch.getMemoriesBySessionID(await openShard(shard), sessionID, kind);
}

/**
 * Swaps the row that has `record.id` for `record` in one transaction: a failed insert rolls
 * the delete back, so the old row survives. The caller carries the pin over. From
 * `memory-replace.ts`.
 */
export async function replaceMemoryRowInShard(
  shard: ShardInfo,
  record: MemoryRecord
): Promise<void> {
  const db = await openShard(shard);
  await db.transaction("write", async (tx) => {
    await tx.execute({ sql: `DELETE FROM memories WHERE id = ?`, args: [record.id] });
    await tursoVectorSearch.insertVectorInTransaction(tx, record);
  });
}

/**
 * Inserts every item in one transaction and pins the pinned ones; one failure rolls all back.
 * `onInserted` hears each ID as its insert lands. From `memory-portability-service.ts`.
 */
export async function insertMemoryRowsInOneTransaction(
  shard: ShardInfo,
  items: Array<{ record: MemoryRecord; isPinned: boolean }>,
  onInserted: (memoryId: string) => void
): Promise<void> {
  const db = await openShard(shard);
  await db.transaction("write", async (tx) => {
    for (const item of items) {
      await tursoVectorSearch.insertVectorInTransaction(tx, item.record);
      if (item.isPinned) {
        await tx.execute({
          sql: `UPDATE memories SET is_pinned = 1 WHERE id = ?`,
          args: [item.record.id],
        });
      }
      onInserted(item.record.id);
    }
  });
}

/** The newest snapshot memorisation of one host session in one project. From `memorisation-store.ts`. */
export async function newestSnapshotRow(
  shard: ShardInfo,
  containerTag: string,
  hostSessionId: string
): Promise<MemoryRow | null> {
  const db = await openShard(shard);
  return db.get(
    `SELECT id, created_at FROM memories
       WHERE type = 'memorisation'
         AND container_tag = ?
         AND json_extract(metadata, '$.memorisation') = 'snapshot'
         AND json_extract(metadata, '$.hostSessionId') = ?
       ORDER BY created_at DESC LIMIT 1`,
    [containerTag, hostSessionId]
  );
}

/** Metadata of the normal rows in one host session that are not history imports (a row with no sourceType counts). From `live-captured-entries.ts`. */
export async function liveCaptureMetadataRows(
  shard: ShardInfo,
  host: string,
  sessionId: string
): Promise<Array<{ metadata: string }>> {
  const db = await openShard(shard);
  return db.all<{ metadata: string }>(
    `SELECT metadata FROM memories WHERE json_valid(metadata) AND ${memoryKindPredicate()}
       AND json_extract(metadata, '$.host') = ?
       AND json_extract(metadata, '$.hostSessionId') = ?
       AND json_extract(metadata, '$.sourceType') IS NOT 'history-import'`,
    [host, sessionId]
  );
}

/** The IDs among `ids` whose row in the shard is a memorisation. From `web-memory-rows.ts`. */
export async function memorisationIdsInShard(shard: ShardInfo, ids: string[]): Promise<string[]> {
  const db = await openShard(shard);
  const rows = await db.all(
    `SELECT id FROM memories WHERE type = 'memorisation' AND id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  return rows.map((row) => String(row.id));
}

/** The IDs among `ids` that have a row in the shard, of any kind. From `chat/chat-runtime.ts`. */
export async function existingMemoryIdsInShard(shard: ShardInfo, ids: string[]): Promise<string[]> {
  const db = await openShard(shard);
  const marks = ids.map(() => "?").join(",");
  const rows = await db.all(`SELECT id FROM memories WHERE id IN (${marks})`, ids);
  return rows.map((row) => String(row.id));
}

/** The ID of the row a history import saved under `importId`, or null. From the history importer (`importer.ts`). */
export async function memoryIdByImportId(
  shard: ShardInfo,
  importId: string
): Promise<string | null> {
  const db = await openShard(shard);
  const row = await db.get(
    `SELECT id FROM memories WHERE json_valid(metadata) AND json_extract(metadata, '$.importId') = ?`,
    [importId]
  );
  return row ? String(row.id) : null;
}

/** Normal rows with their extracted vector, newest first, for dedup. From `deduplication-service.ts`. */
export async function dedupCandidateRows(shard: ShardInfo): Promise<MemoryRow[]> {
  const db = await openShard(shard);
  return db.all(`
          SELECT
            id,
            content,
            container_tag,
            created_at,
            vector_extract(vector) AS vector_json
          FROM memories
          WHERE ${memoryKindPredicate()}
          ORDER BY created_at DESC
        `);
}

/** The IDs of the pinned rows in the shard, of any kind. From `cleanup-service.ts`. */
export async function pinnedMemoryIds(shard: ShardInfo): Promise<string[]> {
  const db = await openShard(shard);
  const pinned = await db.all(`SELECT id FROM memories WHERE is_pinned = 1`);
  return pinned.map((row) => String(row.id));
}

/** Normal rows last updated before `cutoffTime`, pinned or not. From `cleanup-service.ts`. */
export async function memoryRowsUpdatedBefore(
  shard: ShardInfo,
  cutoffTime: number
): Promise<MemoryRow[]> {
  const db = await openShard(shard);
  return db.all(
    `
          SELECT id, container_tag, is_pinned FROM memories
          WHERE updated_at < ? AND ${memoryKindPredicate()}
        `,
    [cutoffTime]
  );
}

/** The shard's recorded embedding dimensions and model rows. From `linked-search.ts`. */
export async function shardEmbeddingRows(
  shard: ShardInfo,
  open?: ShardOpener
): Promise<MemoryRow[]> {
  const db = await openShard(shard, open);
  return db.all(
    `SELECT key, value FROM shard_metadata WHERE key IN ('embedding_dimensions', 'embedding_model')`
  );
}

/** True when the shard has a row with this ID, of any kind. From `linked-search.ts`. */
export async function hasMemoryRow(
  shard: ShardInfo,
  memoryId: string,
  open?: ShardOpener
): Promise<boolean> {
  const db = await openShard(shard, open);
  const row = await db.get(`SELECT id FROM memories WHERE id = ?`, [memoryId]);
  return Boolean(row);
}

/**
 * The row with this ID, of any kind, when it belongs to `containerTag`; null accepts any
 * project. From `linked-search.ts`.
 */
export async function getMemoryRowInProject(
  shard: ShardInfo,
  memoryId: string,
  containerTag: string | null,
  open?: ShardOpener
): Promise<MemoryRow | null> {
  const db = await openShard(shard, open);
  return db.get(`SELECT * FROM memories WHERE id = ? AND (? IS NULL OR container_tag = ?)`, [
    memoryId,
    containerTag,
    containerTag,
  ]);
}
