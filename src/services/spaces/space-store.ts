import { createClient } from "@libsql/client";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { TursoConnectionManager } from "../turso/connection-manager.js";
import { TursoShardManager } from "../turso/shard-manager.js";
import type { ShardInfo } from "../turso/types.js";
import type { TursoDb } from "../turso/turso-db.js";

const METADATA_DB_NAME = "metadata.db";

/** Read mode keeps a connection read-only, so pragmas match the host defaults plus this. */
const READ_ONLY_PRAGMAS = [
  "PRAGMA busy_timeout = 5000",
  "PRAGMA foreign_keys = ON",
  "PRAGMA query_only = ON",
];

export type SpaceStoreMode = "read" | "write";

/** What both modes share: the folder, a private connection manager, and a close. */
export interface SpaceStoreBase {
  /** The space folder this store is bound to (design D1). */
  readonly folder: string;
  /** This store's own connections, allowed only inside `folder`. Closed by `close`. */
  readonly connections: TursoConnectionManager;
  /** Closes every connection this store opened. Call once, when the operation ends. */
  close(): Promise<void>;
}

/**
 * Write store (design D2): transfer targets, import targets and move sources.
 * It creates shards on demand and takes the write and migration locks of `folder`,
 * so it excludes a host that has the same space active.
 */
export interface SpaceWriteStore extends SpaceStoreBase {
  readonly mode: "write";
  /** Shard manager rooted at `folder`; its locks and migration check use the same root. */
  readonly shards: TursoShardManager;
}

/**
 * Read store (design D2): transfer copy sources, previews and linked searches.
 * It opens only files that exist, sets `query_only`, creates no file, changes no
 * schema and takes no lock. A missing metadata.db means an empty space.
 */
export interface SpaceReadStore extends SpaceStoreBase {
  readonly mode: "read";
  /** False when the folder holds no metadata.db: the space has no memories. */
  readonly hasMetadata: boolean;
  /**
   * The registered shards of one scope. An empty `scopeHash` lists every hash of
   * the scope, like `TursoShardManager.getAllShards`.
   */
  listShards(scope: "user" | "project", scopeHash: string): Promise<ShardInfo[]>;
  /** Opens one shard database with `query_only` set. Refuses a file that is missing. */
  openShard(dbPath: string): Promise<TursoDb>;
}

export type SpaceStore = SpaceWriteStore | SpaceReadStore;

/** Maps one metadata.db `shards` row onto a ShardInfo whose path is resolved at `folder`. */
function rowToShardInfo(folder: string, row: Record<string, unknown>): ShardInfo {
  const scope = String(row.scope) as "user" | "project";
  return {
    id: Number(row.id),
    scope,
    scopeHash: String(row.scope_hash),
    shardIndex: Number(row.shard_index),
    dbPath: resolve(join(folder, `${scope}s`, basename(String(row.db_path)))),
    vectorCount: Number(row.vector_count),
    isActive: Number(row.is_active) === 1,
    createdAt: Number(row.created_at),
  };
}

/**
 * Opens a store bound to one space folder (design D1 and D2). The store shares no
 * state with the active space: it brings its own connections, shard manager and
 * locks, all rooted at `folder`. Write stores live for one operation and are closed
 * in `finally`; read stores of linked spaces are cached (see read-store-cache.ts).
 */
export function openSpaceStore(folder: string, mode: "write"): SpaceWriteStore;
export function openSpaceStore(folder: string, mode: "read"): SpaceReadStore;
export function openSpaceStore(folder: string, mode: SpaceStoreMode): SpaceStore {
  const root = resolve(folder);
  const connections = new TursoConnectionManager(createClient, () => [root]);

  if (mode === "write") {
    const shards = new TursoShardManager({
      root: () => root,
      connections,
    });
    return {
      mode,
      folder: root,
      connections,
      shards,
      close: () => connections.closeAll(),
    };
  }

  // Read mode never calls the shard manager: its initialisation writes schema.
  const hasMetadata = existsSync(join(root, METADATA_DB_NAME));
  const openReadExisting = async (dbPath: string): Promise<TursoDb> => {
    const db = await connections.getConnection(dbPath);
    await db.setConnectionPragmas(READ_ONLY_PRAGMAS);
    return db;
  };

  return {
    mode,
    folder: root,
    connections,
    hasMetadata,
    listShards: async (scope, scopeHash) => {
      if (!hasMetadata) return [];
      const db = await openReadExisting(join(root, METADATA_DB_NAME));
      const rows =
        scopeHash === ""
          ? await db.all(`SELECT * FROM shards WHERE scope = ? ORDER BY shard_index ASC`, [scope])
          : await db.all(
              `SELECT * FROM shards WHERE scope = ? AND scope_hash = ? ORDER BY shard_index ASC`,
              [scope, scopeHash]
            );
      return rows.map((row) => rowToShardInfo(root, row));
    },
    openShard: async (dbPath) => {
      if (!existsSync(dbPath)) {
        throw new Error(`Space shard file is missing: ${dbPath}`);
      }
      return openReadExisting(resolve(dbPath));
    },
    close: () => connections.closeAll(),
  };
}
