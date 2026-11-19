import { tursoVectorSearch } from "../../turso/vector-search.js";
import type { MemoryRecord, MemoryRow, StoreDb } from "./types.js";

/**
 * Rows of the `memories` table for a memory space transfer, import and export. Each function
 * works on one shard database the caller opened through a space store, so the store's root and
 * locks stay with the caller. The SQL in this file moved here byte for byte from
 * `spaces/transfer-service.ts`, `spaces/import-space.ts` and `spaces/export-space.ts`.
 */

const ID_CHUNK = 500;
/** The insert writes is_pinned 0, so a pinned row sets its flag with this. */
const PINNED_SQL = `UPDATE memories SET is_pinned = 1 WHERE id = ?`;

/** Every column the export reads. The vector columns are absent by design. */
const EXPORT_COLUMNS =
  "id, content, container_tag, tags, type, created_at, updated_at, metadata, " +
  "display_name, user_name, user_email, project_path, project_name, git_repo_url, is_pinned";

function chunkIds(ids: string[]): string[][] {
  return Array.from({ length: Math.ceil(ids.length / ID_CHUNK) }, (_, index) =>
    ids.slice(index * ID_CHUNK, (index + 1) * ID_CHUNK)
  );
}

/**
 * The rows created inside `since` to `until` (inclusive), of every kind, with both vectors as
 * JSON text. `projectTag` narrows them to one container tag.
 */
export function readTransferRows(
  db: StoreDb,
  since: number,
  until: number,
  projectTag?: string
): Promise<MemoryRow[]> {
  const tagClause = projectTag === undefined ? "" : " AND container_tag = ?";
  const args: (string | number)[] = [since, until];
  if (projectTag !== undefined) args.push(projectTag);
  return db.all<MemoryRow>(
    `
        SELECT id, content, container_tag, tags, type, created_at, updated_at, metadata,
               project_name, is_pinned,
               vector_extract(vector) AS vector_json,
               CASE WHEN tags_vector IS NULL THEN NULL ELSE vector_extract(tags_vector) END
                 AS tags_vector_json
        FROM memories
        WHERE created_at >= ? AND created_at <= ?${tagClause}
      `,
    args
  );
}

/** The `embedding_model` and `embedding_dimensions` rows the shard recorded, as key and value. */
export function readShardEmbeddingMetadata(db: StoreDb): Promise<MemoryRow[]> {
  return db.all(
    `SELECT key, value FROM shard_metadata WHERE key IN ('embedding_model', 'embedding_dimensions')`
  );
}

/** Every memory ID in the shard, of every kind. */
export async function readAllMemoryIds(db: StoreDb): Promise<string[]> {
  return (await db.all(`SELECT id FROM memories`)).map((row) => String(row.id));
}

/** The IDs of `ids` the shard holds, of every kind. */
export async function findMemoryIds(db: StoreDb, ids: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const chunk of chunkIds(ids)) {
    const sql = `SELECT id FROM memories WHERE id IN (${chunk.map(() => "?").join(", ")})`;
    for (const row of await db.all(sql, chunk)) found.push(String(row.id));
  }
  return found;
}

/** The `container_tag` and `content` of every row in the shard, of every kind. */
export function readMemoryTagTexts(db: StoreDb): Promise<MemoryRow[]> {
  return db.all(`SELECT container_tag, content FROM memories`);
}

/** Deletes the rows with these IDs in one write transaction. The caller holds the write lock. */
export async function deleteMemoryRowsByIds(db: StoreDb, ids: string[]): Promise<void> {
  await db.transaction("write", async (tx) => {
    for (const chunk of chunkIds(ids)) {
      await tx.execute({
        sql: `DELETE FROM memories WHERE id IN (${chunk.map(() => "?").join(", ")})`,
        args: chunk,
      });
    }
  });
}

/** Inserts the rows, pinned ones pinned, in one write transaction. The caller holds the write lock. */
export async function insertTransferRows(
  db: StoreDb,
  rows: Array<{ record: MemoryRecord; isPinned: boolean }>
): Promise<void> {
  await db.transaction("write", async (tx) => {
    for (const row of rows) {
      await tursoVectorSearch.insertVectorInTransaction(tx, row.record);
      // The insert writes is_pinned 0, so a pinned row sets its flag after.
      if (row.isPinned) await tx.execute({ sql: PINNED_SQL, args: [row.record.id] });
    }
  });
}

/** Inserts one imported row and pins it when asked, without a transaction. */
export async function insertImportedRow(
  db: StoreDb,
  record: MemoryRecord,
  isPinned: boolean
): Promise<void> {
  await tursoVectorSearch.insertVector(db, record);
  if (isPinned) {
    await db.run(PINNED_SQL, [record.id]);
  }
}

/** How many rows the shard holds, of every kind: the recount a shard's registry count takes. */
export function countShardRows(db: StoreDb): Promise<number> {
  return tursoVectorSearch.countAllVectors(db);
}

/** Every row of the shard with the columns an export reads, of every kind. */
export function readExportRows(db: StoreDb): Promise<MemoryRow[]> {
  return db.all(`SELECT ${EXPORT_COLUMNS} FROM memories`);
}
