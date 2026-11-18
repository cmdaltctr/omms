// The one place the API handlers reach the storage engine. The storage port replaces these re-exports.
export { tursoShardManager } from "../turso/shard-manager.js";
export { tursoVectorSearch } from "../turso/vector-search.js";
export { tursoConnectionManager } from "../turso/connection-manager.js";
export { ensureTursoReady } from "../turso/ready.js";
export { formatTagsForEmbedding } from "../turso/vector-utils.js";
export type { MemoryRecord, ShardInfo } from "../turso/types.js";
