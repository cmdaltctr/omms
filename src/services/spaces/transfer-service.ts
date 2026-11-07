/**
 * The transfer service (task 3.5): it wires the pure engine (`transfer.ts`) to
 * two space stores, resolves the spaces through the registry, refuses the
 * transfers the spec forbids, and logs one record per outcome with counts,
 * space ids and error codes only. The caller passes every setting in place
 * of CONFIG, like `registry.ts` expects.
 */
import { existsSync } from "node:fs";
import { log } from "../logger.js";
import { tursoVectorSearch } from "../turso/vector-search.js";
import type { MemoryRecord, ShardInfo } from "../turso/types.js";
import type { TursoDb } from "../turso/turso-db.js";
import { parseExtractedVector } from "../turso/vector-utils.js";
import { openSpaceStore, type SpaceReadStore, type SpaceWriteStore } from "./space-store.js";
import { findSpace, readRegistryFile, resolveSpaceFolder, type SpacePaths } from "./registry.js";
import type { SpaceFiles } from "./registry-store.js";
import { applyTransfer, previewTransfer } from "./transfer.js";
import type {
  EmbeddingInfo,
  SourceReader,
  TargetShard,
  TargetWriter,
  TransferApplyResult,
  TransferFilter,
  TransferMode,
  TransferPreview,
  TransferRow,
  TransferScope,
  TransferWriteRow,
} from "./transfer-types.js";
import { tagTextKey } from "./transfer-types.js";

const ID_CHUNK = 500;
/** The insert writes is_pinned 0, so a pinned row sets its flag with this. */
const PINNED_SQL = `UPDATE memories SET is_pinned = 1 WHERE id = ?`;

export type TransferRefusalCode =
  "unknown-space" | "same-space" | "archived-space" | "registry-problem";

export interface TransferRefusal {
  ok: false;
  code: TransferRefusalCode;
  error: string;
}

function refusal(code: TransferRefusalCode, error: string): TransferRefusal {
  return { ok: false, code, error };
}

export type SpaceTransferPreviewOutcome = TransferRefusal | { ok: true; preview: TransferPreview };
export type SpaceTransferApplyOutcome = TransferRefusal | { ok: true; result: TransferApplyResult };

export interface SpaceTransferPreviewRequest {
  from: string;
  to: string;
  filter: TransferFilter;
}

export interface SpaceTransferApplyRequest extends SpaceTransferPreviewRequest {
  mode: TransferMode;
  previewMatched?: number;
}

export interface SpaceTransferContext {
  files: SpaceFiles;
  paths: SpacePaths;
  embedding: EmbeddingInfo;
  maxVectorsPerShard: number;
  embed?: (text: string) => Promise<Float32Array>;
}

interface ShardReadAccess {
  listShards(scope: TransferScope): Promise<ShardInfo[]>;
  open(dbPath: string): Promise<TursoDb>;
}

function readAccessOf(store: SpaceReadStore | SpaceWriteStore): ShardReadAccess {
  return {
    listShards: (scope) =>
      store.mode === "write" ? store.shards.getAllShards(scope, "") : store.listShards(scope, ""),
    open: (dbPath) =>
      store.mode === "write" ? store.connections.getConnection(dbPath) : store.openShard(dbPath),
  };
}

/** Registered shards whose file still exists; a vanished file holds no rows. */
async function existingShards(access: ShardReadAccess, scope: TransferScope) {
  return (await access.listShards(scope)).filter((shard) => existsSync(shard.dbPath));
}

async function eachShard(
  access: ShardReadAccess,
  use: (db: TursoDb, shard: ShardInfo) => Promise<void>
): Promise<void> {
  for (const scope of ["user", "project"] as const) {
    for (const shard of await existingShards(access, scope)) {
      await use(await access.open(shard.dbPath), shard);
    }
  }
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function rowToTransferRow(raw: Record<string, unknown>, shard: ShardInfo): TransferRow {
  return {
    id: String(raw.id),
    text: String(raw.content),
    containerTag: String(raw.container_tag),
    tags: optionalString(raw.tags),
    type: optionalString(raw.type),
    createdAt: Number(raw.created_at),
    updatedAt: Number(raw.updated_at),
    metadata: optionalString(raw.metadata),
    isPinned: Number(raw.is_pinned) === 1,
    projectName: optionalString(raw.project_name),
    vector: parseExtractedVector(raw.vector_json) ?? undefined,
    tagsVector: parseExtractedVector(raw.tags_vector_json) ?? undefined,
    shardKey: String(shard.id),
  };
}

async function readRowsAcrossShards(
  access: ShardReadAccess,
  filter: TransferFilter
): Promise<TransferRow[]> {
  const tagClause = filter.projectTag === undefined ? "" : " AND container_tag = ?";
  const args: (string | number)[] = [filter.since, filter.until];
  if (filter.projectTag !== undefined) args.push(filter.projectTag);
  const rows: TransferRow[] = [];
  await eachShard(access, async (db, shard) => {
    const raw = await db.all<Record<string, unknown>>(
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
    for (const item of raw) rows.push(rowToTransferRow(item, shard));
  });
  return rows;
}

/**
 * The settings a space's shards record. All shards must agree, or the vectors
 * are not provably reusable and this reads as undefined.
 */
async function readEmbeddingInfo(access: ShardReadAccess): Promise<EmbeddingInfo | undefined> {
  let agreed: EmbeddingInfo | undefined;
  for (const scope of ["user", "project"] as const) {
    for (const shard of await existingShards(access, scope)) {
      const db = await access.open(shard.dbPath);
      const meta = await db.all(
        `SELECT key, value FROM shard_metadata WHERE key IN ('embedding_model', 'embedding_dimensions')`
      );
      const model = meta.find((row) => String(row.key) === "embedding_model")?.value;
      const dimensions = meta.find((row) => String(row.key) === "embedding_dimensions")?.value;
      if (typeof model !== "string" || dimensions === undefined) return undefined;
      const entry = { model, dimensions: Number(dimensions) };
      if (agreed && (agreed.model !== entry.model || agreed.dimensions !== entry.dimensions)) {
        return undefined;
      }
      agreed ??= entry;
    }
  }
  return agreed;
}

async function readAllIds(access: ShardReadAccess): Promise<Set<string>> {
  const ids = new Set<string>();
  await eachShard(access, async (db) => {
    for (const row of await db.all(`SELECT id FROM memories`)) ids.add(String(row.id));
  });
  return ids;
}

async function findIdsIn(access: ShardReadAccess, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  await eachShard(access, async (db) => {
    for (const chunk of chunkIds(ids)) {
      const sql = `SELECT id FROM memories WHERE id IN (${chunk.map(() => "?").join(", ")})`;
      for (const row of await db.all(sql, chunk)) found.add(String(row.id));
    }
  });
  return found;
}

async function readAllTagTexts(access: ShardReadAccess): Promise<Set<string>> {
  const keys = new Set<string>();
  await eachShard(access, async (db) => {
    for (const row of await db.all(`SELECT container_tag, content FROM memories`)) {
      keys.add(tagTextKey(String(row.container_tag), String(row.content)));
    }
  });
  return keys;
}

function chunkIds(ids: string[]): string[][] {
  return Array.from({ length: Math.ceil(ids.length / ID_CHUNK) }, (_, index) =>
    ids.slice(index * ID_CHUNK, (index + 1) * ID_CHUNK)
  );
}

/** The source side of the engine: a read store, plus a write store for a move. */
class SpaceSourceReader implements SourceReader {
  constructor(
    private readonly access: ShardReadAccess,
    private readonly write?: SpaceWriteStore
  ) {}

  readRows(filter: TransferFilter) {
    return readRowsAcrossShards(this.access, filter);
  }
  getEmbeddingInfo() {
    return readEmbeddingInfo(this.access);
  }

  async getShardCounts(shardKeys: string[]) {
    const write = this.requireWrite();
    const counts = new Map<string, number>();
    for (const key of shardKeys) {
      const shard = await write.shards.getShardById(Number(key));
      counts.set(key, shard?.vectorCount ?? 0);
    }
    return counts;
  }

  async deleteFromShard(shardKey: string, ids: string[]): Promise<void> {
    const write = this.requireWrite();
    const shard = await write.shards.getShardById(Number(shardKey));
    if (!shard) throw new Error(`Source shard ${shardKey} is not registered.`);
    await write.shards.withScopeWriteLock(shard.scope, shard.scopeHash, async () => {
      const db = await write.connections.getConnection(shard.dbPath);
      await db.transaction("write", async (tx) => {
        for (const chunk of chunkIds(ids)) {
          await tx.execute({
            sql: `DELETE FROM memories WHERE id IN (${chunk.map(() => "?").join(", ")})`,
            args: chunk,
          });
        }
      });
      // A recount, not a delta, keeps the count right if another writer raced.
      await write.shards.setVectorCount(shard.id, await tursoVectorSearch.countAllVectors(db));
    });
  }

  async setShardCount(shardKey: string, _count: number): Promise<void> {
    const write = this.requireWrite();
    const shard = await write.shards.getShardById(Number(shardKey));
    if (!shard) return;
    const db = await write.connections.getConnection(shard.dbPath);
    await write.shards.setVectorCount(shard.id, await tursoVectorSearch.countAllVectors(db));
  }

  private requireWrite(): SpaceWriteStore {
    if (!this.write) throw new Error("Only a move reaches this step; a copy source is read-only.");
    return this.write;
  }
}

function toMemoryRecord(row: TransferWriteRow): MemoryRecord {
  return {
    id: row.id,
    content: row.text,
    vector: row.vector,
    tagsVector: row.tagsVector,
    containerTag: row.containerTag,
    tags: row.tags,
    type: row.type,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: row.metadata,
  };
}

class SpaceTargetWriter implements TargetWriter {
  private readonly shardInfo = new Map<string, ShardInfo>();

  constructor(
    private readonly store: SpaceWriteStore,
    private readonly embedding: EmbeddingInfo
  ) {}

  loadExistingIds() {
    return readAllIds(readAccessOf(this.store));
  }
  loadExistingTagTexts() {
    return readAllTagTexts(readAccessOf(this.store));
  }
  getEmbeddingSettings(): Promise<EmbeddingInfo> {
    return Promise.resolve(this.embedding);
  }

  async getWriteShard(scope: TransferScope, scopeHash: string) {
    const shard = await this.store.shards.getWriteShard(scope, scopeHash);
    this.shardInfo.set(String(shard.id), shard);
    return { key: String(shard.id), vectorCount: shard.vectorCount };
  }

  async insertBatch(shard: TargetShard, rows: TransferWriteRow[]): Promise<void> {
    const info = this.offeredShard(shard.key);
    await this.store.shards.withScopeWriteLock(info.scope, info.scopeHash, async () => {
      const db = await this.store.connections.getConnection(info.dbPath);
      await db.transaction("write", async (tx) => {
        for (const row of rows) {
          await tursoVectorSearch.insertVectorInTransaction(tx, toMemoryRecord(row));
          // The insert writes is_pinned 0, so a pinned row sets its flag after.
          if (row.isPinned) await tx.execute({ sql: PINNED_SQL, args: [row.id] });
        }
      });
      // A recount, not a delta, keeps the count right if another writer raced.
      await this.store.shards.setVectorCount(info.id, await tursoVectorSearch.countAllVectors(db));
    });
  }

  async setShardCount(shardKey: string, _count: number): Promise<void> {
    const info = this.offeredShard(shardKey);
    const db = await this.store.connections.getConnection(info.dbPath);
    await this.store.shards.setVectorCount(info.id, await tursoVectorSearch.countAllVectors(db));
  }

  findExistingIds(ids: string[]) {
    return findIdsIn(readAccessOf(this.store), ids);
  }

  private offeredShard(shardKey: string): ShardInfo {
    const info = this.shardInfo.get(shardKey);
    if (!info) throw new Error(`Target shard ${shardKey} was never offered for writing.`);
    return info;
  }
}

/**
 * The read-only target of a preview: reads from the read store, every write
 * refused. Opening an empty target in write mode would create its metadata.db.
 */
class ReadOnlyTarget implements TargetWriter {
  constructor(private readonly access: ShardReadAccess) {}
  loadExistingIds() {
    return readAllIds(this.access);
  }
  loadExistingTagTexts() {
    return readAllTagTexts(this.access);
  }
  getEmbeddingSettings(): Promise<EmbeddingInfo> {
    return this.refuse();
  }
  getWriteShard(): Promise<TargetShard> {
    return this.refuse();
  }
  insertBatch(): Promise<void> {
    return this.refuse();
  }
  setShardCount(): Promise<void> {
    return this.refuse();
  }
  findExistingIds(ids: string[]) {
    return findIdsIn(this.access, ids);
  }
  private readonly refuse = () =>
    Promise.reject(new Error("A preview must not change the target."));
}

function defaultEmbed(text: string): Promise<Float32Array> {
  return import("../embedding.js").then(({ embeddingService }) =>
    embeddingService.embedWithTimeout(text, { task: "document" })
  );
}

/** Resolves both spaces and applies the refusals the spec demands, in order. */
function resolveSpaces(request: SpaceTransferPreviewRequest, context: SpaceTransferContext) {
  const read = readRegistryFile(context.files.registryPath);
  if (read.problem) return refusal("registry-problem", read.problem);
  const source = findSpace(read.registry, request.from);
  const target = findSpace(read.registry, request.to);
  if (!source) return refusal("unknown-space", `No space named "${request.from}".`);
  if (!target) return refusal("unknown-space", `No space named "${request.to}".`);
  if (source.id === target.id) {
    return refusal(
      "same-space",
      `The source and the target must differ; both are "${source.name}".`
    );
  }
  if (source.archived) {
    return refusal("archived-space", `The source space "${source.name}" is archived.`);
  }
  if (target.archived) {
    return refusal("archived-space", `The target space "${target.name}" is archived.`);
  }
  return {
    ok: true,
    sourceId: source.id,
    targetId: target.id,
    sourceFolder: resolveSpaceFolder(source.id, context.paths),
    targetFolder: resolveSpaceFolder(target.id, context.paths),
  } as const;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown error";
}

/** Previews a transfer without changing either space: read stores, no locks. */
export async function previewSpaceTransfer(
  request: SpaceTransferPreviewRequest,
  context: SpaceTransferContext
): Promise<SpaceTransferPreviewOutcome> {
  const resolved = resolveSpaces(request, context);
  if (!resolved.ok) {
    logRefusal(request, resolved.code);
    return resolved;
  }
  const ids = { from: resolved.sourceId, to: resolved.targetId };
  const source = openSpaceStore(resolved.sourceFolder, "read");
  const target = openSpaceStore(resolved.targetFolder, "read");
  try {
    const preview = await previewTransfer({
      source: new SpaceSourceReader(readAccessOf(source)),
      target: new ReadOnlyTarget(readAccessOf(target)),
      filter: request.filter,
    });
    log("space transfer preview", {
      ...ids,
      matched: preview.matched,
      duplicates: preview.duplicates,
      toCopy: preview.toCopy,
    });
    return { ok: true, preview };
  } catch (error) {
    log("space transfer preview failed", { ...ids, error: errorName(error) }, "error");
    throw error;
  } finally {
    await source.close();
    await target.close();
  }
}

/**
 * Runs a copy or a move. The target opens in write mode; the source opens in
 * write mode only for a move. Engine failures land in `result.error`; the call
 * throws only on an unexpected store failure, after logging its name.
 */
export async function applySpaceTransfer(
  request: SpaceTransferApplyRequest,
  context: SpaceTransferContext
): Promise<SpaceTransferApplyOutcome> {
  const resolved = resolveSpaces(request, context);
  if (!resolved.ok) {
    logRefusal(request, resolved.code);
    return resolved;
  }
  const ids = { from: resolved.sourceId, to: resolved.targetId };
  const move = request.mode === "move";
  const sourceStore = move
    ? openSpaceStore(resolved.sourceFolder, "write")
    : openSpaceStore(resolved.sourceFolder, "read");
  const targetStore = openSpaceStore(resolved.targetFolder, "write");
  try {
    const write = move ? (sourceStore as SpaceWriteStore) : undefined;
    const source = new SpaceSourceReader(readAccessOf(sourceStore), write);
    const result = await applyTransfer({
      source,
      target: new SpaceTargetWriter(targetStore, context.embedding),
      filter: request.filter,
      mode: request.mode,
      maxVectorsPerShard: context.maxVectorsPerShard,
      embed: context.embed ?? defaultEmbed,
      ...(request.previewMatched === undefined ? {} : { previewMatched: request.previewMatched }),
    });
    log("space transfer", {
      ...ids,
      mode: request.mode,
      ok: result.ok,
      copied: result.copied,
      skipped: result.skipped,
      removed: result.removed,
      changedFromPreview: result.changedFromPreview,
      ...(result.error ? { step: result.error.step } : {}),
    });
    return { ok: true, result };
  } catch (error) {
    log("space transfer failed", { ...ids, mode: request.mode, error: errorName(error) }, "error");
    throw error;
  } finally {
    await sourceStore.close();
    await targetStore.close();
  }
}

function logRefusal(request: SpaceTransferPreviewRequest, code: TransferRefusalCode): void {
  log("space transfer refused", { from: request.from, to: request.to, code }, "warn");
}
