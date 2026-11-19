import type { MemoryHost } from "../types/index.js";
import { hasMemoryRegistry, listMemoryShards } from "./storage/memory/shards.js";
import { liveCaptureMetadataRows } from "./storage/memory/rows.js";

/** Read user and assistant IDs saved by live capture in one project session. */
export async function findLiveCapturedEntryIds(
  projectHash: string,
  host: MemoryHost,
  sessionId: string
): Promise<Set<string>> {
  const entries = new Set<string>();
  if (!hasMemoryRegistry()) return entries;
  const shards = await listMemoryShards("project", projectHash);
  for (const shard of shards) {
    const rows = await liveCaptureMetadataRows(shard, host, sessionId);
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
