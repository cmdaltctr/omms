/**
 * Shard-discovery and opencode_ row-counting helpers for the container tag
 * prefix migration (see tag-prefix-migration.ts for the migration itself).
 */

import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import { tursoShardManager } from "./turso/shard-manager.js";
import type { TursoDb } from "./turso/turso-db.js";

export const FROM_PREFIX_WITH_SEP = "opencode_";

/** Matches the shard file naming used by tursoShardManager.getShardPath. */
const SHARD_FILENAME_RE = /^(user|project)_([a-f0-9]{16})_shard_(\d+)\.db$/;

export interface ShardTarget {
  dbPath: string;
  scope: "user" | "project";
  scopeHash: string;
  shardIndex: number;
}

function listShardDirFiles(storePath: string, scopeDir: "users" | "projects"): string[] {
  const dir = join(storePath, scopeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".db") && !file.includes(".bak") && !file.includes(".tmp"))
    .map((file) => join(dir, file));
}

/**
 * Enumerate every shard file to migrate: the metadata.db registry first (the
 * authoritative set), then any on-disk shard file in users/ or projects/ not
 * present in the registry (orphans still need rewriting). Deduplicated by
 * resolved path, ordered deterministically.
 */
export async function enumerateShardTargets(storePath: string): Promise<ShardTarget[]> {
  const byPath = new Map<string, ShardTarget>();

  for (const scope of ["user", "project"] as const) {
    for (const shard of await tursoShardManager.getAllShards(scope, "")) {
      byPath.set(shard.dbPath, {
        dbPath: shard.dbPath,
        scope,
        scopeHash: shard.scopeHash,
        shardIndex: shard.shardIndex,
      });
    }
  }

  for (const scopeDir of ["users", "projects"] as const) {
    for (const dbPath of listShardDirFiles(storePath, scopeDir)) {
      const match = SHARD_FILENAME_RE.exec(basename(dbPath));
      if (!match) continue;
      const resolved = dbPath;
      if (byPath.has(resolved)) continue;
      byPath.set(resolved, {
        dbPath,
        scope: match[1] as "user" | "project",
        scopeHash: match[2]!,
        shardIndex: Number(match[3]),
      });
    }
  }

  return [...byPath.values()].sort((a, b) => a.dbPath.localeCompare(b.dbPath));
}

async function countPrefixedInConnection(
  db: TursoDb,
  prefixWithSep: string
): Promise<number | null> {
  try {
    const row = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM memories WHERE container_tag LIKE ? ESCAPE '\\'`,
      [`${prefixWithSep.slice(0, -1)}\\_%`]
    );
    return Number(row?.count ?? 0);
  } catch {
    // Files without a memories table (or unreadable ones) contribute nothing.
    return null;
  }
}

/**
 * Read-only helper: total rows still carrying the `opencode_` prefix across
 * every shard file in the store. Also fails loudly when a non-shard .db file
 * in users/ or projects/ still carries opencode_ rows: such a file cannot be
 * locked per scope, and silently skipping it would leave a mixed-prefix
 * namespace (design D2 forbids that).
 */
export async function countOpencodePrefixedRows(storePath: string): Promise<number> {
  let total = 0;
  for (const scopeDir of ["users", "projects"] as const) {
    for (const dbPath of listShardDirFiles(storePath, scopeDir)) {
      const db = await tursoConnectionManager.getConnection(dbPath);
      const count = await countPrefixedInConnection(db, FROM_PREFIX_WITH_SEP);
      if (count === null) continue;
      const matchesNaming = SHARD_FILENAME_RE.test(basename(dbPath));
      if (!matchesNaming && count > 0) {
        throw new Error(
          `Shard file ${dbPath} does not match the shard filename pattern ` +
            `(scope_hash_shard_N.db) and still carries ${count} opencode_ row(s). ` +
            `Rename or inspect the file manually, then rerun the migration.`
        );
      }
      total += count;
    }
  }
  return total;
}
