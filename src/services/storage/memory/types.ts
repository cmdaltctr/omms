import type { TursoDb } from "../../turso/turso-db.js";

export type { MemoryRecord, SearchResult, ShardInfo } from "../../turso/types.js";

/** The two shard scopes of the memory store. */
export type ShardScope = "user" | "project";

/** One stored `memories` row as the engine returns it, with snake_case column names. */
export type MemoryRow = Record<string, unknown>;

/**
 * An open shard database. Callers treat it as opaque: they get one from a read-only space
 * store and hand it back through a `ShardOpener`.
 */
export type StoreDb = TursoDb;

/** Opens a shard database by path. Linked-space reads pass a read-only opener. */
export type ShardOpener = (dbPath: string) => Promise<StoreDb>;
