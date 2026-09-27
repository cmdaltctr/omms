import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "../config.js";
import type { MemoryHost } from "../types/index.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import { tursoShardManager } from "./turso/shard-manager.js";

/** Read user and assistant IDs saved by live capture in one project session. */
export async function findLiveCapturedEntryIds(
  projectHash: string,
  host: MemoryHost,
  sessionId: string
): Promise<Set<string>> {
  const entries = new Set<string>();
  if (!existsSync(join(CONFIG.storagePath, "metadata.db"))) return entries;
  const shards = await tursoShardManager.getAllShards("project", projectHash);
  for (const shard of shards) {
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const rows = await db.all<{ metadata: string }>(
      `SELECT metadata FROM memories WHERE json_valid(metadata)
       AND json_extract(metadata, '$.host') = ?
       AND json_extract(metadata, '$.hostSessionId') = ?
       AND json_extract(metadata, '$.sourceType') != 'history-import'`,
      [host, sessionId]
    );
    for (const row of rows) {
      const metadata: unknown = JSON.parse(row.metadata);
      if (!metadata || typeof metadata !== "object") continue;
      const provenance = metadata as { promptId?: unknown; sourceEntryIds?: unknown };
      if (typeof provenance.promptId === "string") entries.add(provenance.promptId);
      const ids = provenance.sourceEntryIds;
      if (Array.isArray(ids)) {
        for (const id of ids) if (typeof id === "string") entries.add(id);
      }
    }
  }
  return entries;
}
