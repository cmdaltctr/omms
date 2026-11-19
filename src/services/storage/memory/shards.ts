import { existsSync } from "node:fs";
import { join } from "node:path";
import { getStoragePath } from "../active-space-access.js";
import { tursoConnectionManager } from "../../turso/connection-manager.js";
import { tursoShardManager } from "../../turso/shard-manager.js";
import { acquireTursoOperationLock } from "../../turso/operation-lock.js";
import { ensureTursoReady } from "../../turso/ready.js";
import type { ShardInfo, ShardScope } from "./types.js";

/**
 * The memory store's shards: discovery, the registry counts, the write locks and readiness.
 * Every function reads the engine's live singletons on call, and every path comes from the
 * store settings reader on call, so a memory space switch needs no reset here.
 */

/** Runs the one-time store gates (legacy and tag prefix migration, interrupted swap) once. */
export function ensureMemoryStoreReady(): Promise<void> {
  return ensureTursoReady();
}

/** True when the active store has a shard registry (`metadata.db`), so it can hold memories. */
export function hasMemoryRegistry(): boolean {
  return existsSync(join(getStoragePath(), "metadata.db"));
}

/** The shards of one scope, oldest first. An empty `scopeHash` lists every shard of the scope. */
export function listMemoryShards(scope: ShardScope, scopeHash: string): Promise<ShardInfo[]> {
  return tursoShardManager.getAllShards(scope, scopeHash);
}

/** Every shard of both scopes: the `first` scope's shards, then the other scope's. */
export async function listEveryMemoryShard(first: ShardScope): Promise<ShardInfo[]> {
  const second: ShardScope = first === "user" ? "project" : "user";
  const firstShards = await tursoShardManager.getAllShards(first, "");
  const secondShards = await tursoShardManager.getAllShards(second, "");
  return [...firstShards, ...secondShards];
}

/** The newest active shard of one scope, or null. Does not create one. */
export function getActiveMemoryShard(
  scope: ShardScope,
  scopeHash: string
): Promise<ShardInfo | null> {
  return tursoShardManager.getActiveShard(scope, scopeHash);
}

/** The shard a new memory of this scope goes to; creates one when the active shard is full. */
export function getWriteMemoryShard(scope: ShardScope, scopeHash: string): Promise<ShardInfo> {
  return tursoShardManager.getWriteShard(scope, scopeHash);
}

/** Creates and registers shard `shardIndex` of one scope. */
export function createMemoryShard(
  scope: ShardScope,
  scopeHash: string,
  shardIndex: number
): Promise<ShardInfo> {
  return tursoShardManager.createShard(scope, scopeHash, shardIndex);
}

/** Runs `fn` under the scope's in-process queue and its cross-process write lock. */
export function withMemoryScopeWriteLock<T>(
  scope: ShardScope,
  scopeHash: string,
  fn: () => Promise<T>
): Promise<T> {
  return tursoShardManager.withScopeWriteLock(scope, scopeHash, fn);
}

/** Adds one to the shard's registry row count. */
export function incrementShardCount(shardId: number): Promise<void> {
  return tursoShardManager.incrementVectorCount(shardId);
}

/** Takes one from the shard's registry row count. */
export function decrementShardCount(shardId: number): Promise<void> {
  return tursoShardManager.decrementVectorCount(shardId);
}

/** Sets the shard's registry row count. */
export function setShardCount(shardId: number, count: number): Promise<void> {
  return tursoShardManager.setVectorCount(shardId, count);
}

/**
 * Takes the store-wide operation lock in the active storage folder. Throws when a migration
 * holds it. Returns the release function.
 */
export function acquireMemoryOperationLock(operation: string): () => void {
  return acquireTursoOperationLock(operation, getStoragePath());
}

/** Closes every open store connection at once, for a process that is about to exit. */
export function closeAllStoreConnectionsSync(): void {
  tursoConnectionManager.closeAllSync();
}
