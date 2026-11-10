import { tursoConnectionManager } from "./connection-manager.js";
import { log } from "../logger.js";
import type { SearchResult, ShardInfo } from "./types.js";
import { distanceToSimilarity, vectorToJson } from "./vector-utils.js";
import { tagMatchBoost } from "./tag-match.js";
import { exactScanKind } from "./exact-scan.js";
import { boostedSimilarity, searchKeywords } from "./keyword-search.js";
import { fuseShardResults } from "./rank-fusion.js";
import type { KeywordMode } from "../../utils/keyword-boost.js";
import type { TursoDb } from "./turso-db.js";
import { tursoVectorWrites } from "./vector-writes.js";
import { memoryKindPredicate, type MemoryKind } from "../memory-kind.js";

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export class TursoVectorSearch {
  insertVectorInTransaction = tursoVectorWrites.insertVectorInTransaction.bind(tursoVectorWrites);
  insertVector = tursoVectorWrites.insertVector.bind(tursoVectorWrites);

  async searchInShard(
    shard: ShardInfo,
    queryVector: Float32Array,
    containerTag: string,
    limit: number,
    queryText?: string,
    keywordBoost = 0,
    keywordMode: KeywordMode = "boost",
    /** Opens the shard database; linked-space searches pass a read-only opener. */
    openDb: (dbPath: string) => Promise<TursoDb> = (dbPath) =>
      tursoConnectionManager.getConnection(dbPath),
    kind: MemoryKind = "normal"
  ): Promise<SearchResult[]> {
    const db = await openDb(shard.dbPath);
    const queryJson = vectorToJson(queryVector);
    // Over-fetch aggressively when filtering by container_tag after ANN,
    // because post-filtering can discard many DiskANN neighbors.
    const k = containerTag === "" ? Math.max(limit * 4, 32) : Math.max(limit * 16, 128);

    const contentResults = await this.searchKind(
      db,
      queryJson,
      k,
      containerTag,
      "memories_vec_idx",
      "vector",
      kind,
      limit
    );
    const tagsResults = await this.searchKind(
      db,
      queryJson,
      k,
      containerTag,
      "memories_tags_vec_idx",
      "tags_vector",
      kind,
      limit
    );

    const candidateIds = new Set<string>();
    for (const result of contentResults) candidateIds.add(result.id);
    for (const result of tagsResults) candidateIds.add(result.id);
    const kwHits =
      keywordBoost > 0
        ? await searchKeywords(db, queryText, containerTag, Math.max(limit * 4, 32), kind)
        : null;
    for (const id of kwHits?.scores.keys() ?? []) candidateIds.add(id);

    const ids = Array.from(candidateIds);
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(",");
    // Recompute exact distances for hydrated rows so tag-only / content-only ANN
    // hits still get a full hybrid score (missing ANN side is not forced to 0).
    const rows = await db.all(
      containerTag === ""
        ? `
      SELECT id, content, tags, type, created_at, metadata, container_tag,
             display_name, user_name, user_email, project_path, project_name,
             git_repo_url, is_pinned,
             vector_distance_cos(vector, vector32(?)) AS content_dist,
             CASE WHEN tags_vector IS NOT NULL
               THEN vector_distance_cos(tags_vector, vector32(?))
               ELSE NULL END AS tags_dist
      FROM memories
      WHERE id IN (${placeholders}) AND ${memoryKindPredicate("type", kind)}
    `
        : `
      SELECT id, content, tags, type, created_at, metadata, container_tag,
             display_name, user_name, user_email, project_path, project_name,
             git_repo_url, is_pinned,
             vector_distance_cos(vector, vector32(?)) AS content_dist,
             CASE WHEN tags_vector IS NOT NULL
               THEN vector_distance_cos(tags_vector, vector32(?))
               ELSE NULL END AS tags_dist
      FROM memories
      WHERE id IN (${placeholders}) AND container_tag = ? AND ${memoryKindPredicate("type", kind)}
    `,
      containerTag === ""
        ? [queryJson, queryJson, ...ids]
        : [queryJson, queryJson, ...ids, containerTag]
    );

    const hydratedResults = rows.map((row: Record<string, unknown>) => {
      const contentSim = distanceToSimilarity(Number(row.content_dist));
      const tagsSim =
        row.tags_dist == null || row.tags_dist === undefined
          ? 0
          : distanceToSimilarity(Number(row.tags_dist));
      const memoryTagsStr = String(row.tags || "");
      const exactMatchBoost = tagMatchBoost(queryText, memoryTagsStr);

      const finalTagsSim = Math.max(tagsSim, exactMatchBoost);
      // Every memorisation carries the same tag, so the tags half is near constant and
      // pulls a close match down. Score memorisations by content alone.
      const base = kind === "memorisation" ? contentSim : contentSim * 0.6 + finalTagsSim * 0.4;
      const similarity = boostedSimilarity(base, kwHits, String(row.id), keywordBoost, keywordMode);

      return {
        id: String(row.id),
        memory: String(row.content),
        similarity,
        keywordScore: kwHits?.scores.get(String(row.id)),
        createdAt: Number(row.created_at),
        tags: memoryTagsStr ? memoryTagsStr.split(",") : [],
        type: row.type ? String(row.type) : undefined,
        metadata: parseMetadata(row.metadata),
        containerTag: String(row.container_tag),
        displayName: row.display_name ? String(row.display_name) : undefined,
        userName: row.user_name ? String(row.user_name) : undefined,
        userEmail: row.user_email ? String(row.user_email) : undefined,
        projectPath: row.project_path ? String(row.project_path) : undefined,
        projectName: row.project_name ? String(row.project_name) : undefined,
        gitRepoUrl: row.git_repo_url ? String(row.git_repo_url) : undefined,
        isPinned: row.is_pinned,
      };
    });

    hydratedResults.sort((a, b) => b.similarity - a.similarity);
    // Rank fusion needs the word-only candidates too; it applies the limit itself.
    const fusing = keywordMode === "rrf" && keywordBoost > 0;
    return fusing ? hydratedResults : hydratedResults.slice(0, Math.max(0, limit));
  }

  private async searchKind(
    db: TursoDb,
    queryJson: string,
    k: number,
    containerTag: string,
    indexName: string,
    columnName: string,
    kind: MemoryKind = "normal",
    wanted = 0
  ): Promise<Array<{ id: string; similarity: number }>> {
    // The ANN index covers every row, and the kind filter runs after it. Normal rows
    // can fill all k candidates and hide the few memorisations. Memorisations are few,
    // so scan them exactly; the exact scan filters by kind in SQL.
    if (kind === "memorisation") {
      return exactScanKind(db, queryJson, k, containerTag, columnName, kind);
    }
    try {
      const rows = await db.all(
        containerTag === ""
          ? `
          SELECT m.id AS id, vector_distance_cos(m.${columnName}, vector32(?)) AS dist
          FROM vector_top_k('${indexName}', vector32(?), ?) AS v
          CROSS JOIN memories m ON m.rowid = v.id
          WHERE m.${columnName} IS NOT NULL AND ${memoryKindPredicate("m.type", kind)}
        `
          : `
          SELECT m.id AS id, vector_distance_cos(m.${columnName}, vector32(?)) AS dist
          FROM vector_top_k('${indexName}', vector32(?), ?) AS v
          CROSS JOIN memories m ON m.rowid = v.id
          WHERE m.${columnName} IS NOT NULL AND m.container_tag = ? AND ${memoryKindPredicate("m.type", kind)}
        `,
        containerTag === "" ? [queryJson, queryJson, k] : [queryJson, queryJson, k, containerTag]
      );

      // Memorisations or other projects can fill the k candidates and the filters then
      // drop them all. A short result is rare, so only then pay for the exact scan.
      if (rows.length < wanted) {
        return exactScanKind(db, queryJson, k, containerTag, columnName, kind);
      }

      return rows.map((row) => ({
        id: String(row.id),
        similarity: distanceToSimilarity(Number(row.dist)),
      }));
    } catch (error) {
      log(
        "Turso vector_top_k failed; falling back to exact scan",
        {
          indexName,
          error: String(error),
        },
        "warn"
      );
      return exactScanKind(db, queryJson, k, containerTag, columnName, kind);
    }
  }

  async searchAcrossShards(
    shards: ShardInfo[],
    queryVector: Float32Array,
    containerTag: string,
    limit: number,
    similarityThreshold: number,
    queryText?: string,
    keywordBoost = 0,
    keywordMode: KeywordMode = "boost",
    /** Opens each shard database; linked-space searches pass a read-only opener. */
    openDb?: (dbPath: string) => Promise<TursoDb>,
    kind: MemoryKind = "normal"
  ): Promise<{ results: SearchResult[]; warnings: string[] }> {
    const shardErrors: Array<{ shardId: number; error: string }> = [];

    const shardPromises = shards.map(async (shard) => {
      try {
        return await this.searchInShard(
          shard,
          queryVector,
          containerTag,
          limit,
          queryText,
          keywordBoost,
          keywordMode,
          openDb,
          kind
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("Shard search error", { shardId: shard.id, error: message }, "error");
        shardErrors.push({ shardId: shard.id, error: message });
        return [];
      }
    });

    const resultsArray = await Promise.all(shardPromises);

    if (shardErrors.length > 0 && shardErrors.length === shards.length) {
      throw new Error(
        `Vector search failed on all shards: ${shardErrors.map((entry) => `${entry.shardId}: ${entry.error}`).join("; ")}`
      );
    }

    const warnings =
      shardErrors.length > 0
        ? [
            `Vector search completed with partial shard failures (${shardErrors.length}/${shards.length}): ${shardErrors
              .map((entry) => `${entry.shardId}: ${entry.error}`)
              .join("; ")}`,
          ]
        : [];

    if (warnings.length > 0) {
      log(
        "Vector search completed with partial shard failures",
        {
          failedShards: shardErrors,
          totalShards: shards.length,
        },
        "warn"
      );
    }

    const allResults = resultsArray.flat();
    if (keywordMode === "rrf" && keywordBoost > 0) {
      return { results: fuseShardResults(allResults, similarityThreshold, limit), warnings };
    }
    allResults.sort((a, b) => b.similarity - a.similarity);
    return {
      results: allResults
        .filter((result) => result.similarity >= similarityThreshold)
        .slice(0, limit),
      warnings,
    };
  }

  async deleteVector(db: TursoDb, memoryId: string): Promise<void> {
    await db.run(`DELETE FROM memories WHERE id = ?`, [memoryId]);
  }

  async updateVector(
    db: TursoDb,
    memoryId: string,
    vector: Float32Array,
    tagsVector?: Float32Array,
    tags?: string
  ): Promise<void> {
    const contentVector = vectorToJson(vector);
    if (tagsVector && tags !== undefined) {
      await db.execute(
        `UPDATE memories SET tags = ?, vector = vector32(?), tags_vector = vector32(?) WHERE id = ?`,
        [tags, contentVector, vectorToJson(tagsVector), memoryId]
      );
    } else if (tagsVector) {
      await db.execute(
        `UPDATE memories SET vector = vector32(?), tags_vector = vector32(?) WHERE id = ?`,
        [contentVector, vectorToJson(tagsVector), memoryId]
      );
    } else {
      await db.execute(
        `UPDATE memories SET vector = vector32(?), tags_vector = NULL WHERE id = ?`,
        [contentVector, memoryId]
      );
    }
  }

  async listMemories(
    db: TursoDb,
    containerTag: string,
    limit: number,
    kind: MemoryKind = "normal"
  ): Promise<Record<string, unknown>[]> {
    return containerTag === ""
      ? db.all(
          `
      SELECT * FROM memories
      WHERE ${memoryKindPredicate("type", kind)}
      ORDER BY created_at DESC
      LIMIT ?
    `,
          [limit]
        )
      : db.all(
          `
      SELECT * FROM memories
      WHERE container_tag = ? AND ${memoryKindPredicate("type", kind)}
      ORDER BY created_at DESC
      LIMIT ?
    `,
          [containerTag, limit]
        );
  }

  /** Every row of one kind. Pass "all" only for kind-neutral readers such as export. */
  async getAllMemories(
    db: TursoDb,
    kind: MemoryKind | "all" = "normal"
  ): Promise<Record<string, unknown>[]> {
    return db.all(
      `SELECT * FROM memories WHERE ${kind === "all" ? "1 = 1" : memoryKindPredicate("type", kind)} ORDER BY created_at DESC`
    );
  }

  async getAllMemoriesWithExtractedVectors(
    db: TursoDb
  ): Promise<Array<Record<string, unknown> & { vector_json: string | null }>> {
    return db.all(`
      SELECT
        id,
        content,
        container_tag,
        created_at,
        vector_extract(vector) AS vector_json
      FROM memories
      ORDER BY created_at DESC
    `);
  }

  async getMemoryById(db: TursoDb, memoryId: string): Promise<Record<string, unknown> | null> {
    return db.get(`SELECT * FROM memories WHERE id = ?`, [memoryId]);
  }

  async getMemoriesBySessionID(
    db: TursoDb,
    sessionID: string,
    kind: MemoryKind = "normal"
  ): Promise<Record<string, unknown>[]> {
    const rows = await db.all(
      `
      SELECT * FROM memories
      WHERE metadata LIKE ? AND ${memoryKindPredicate("type", kind)}
      ORDER BY created_at DESC
    `,
      [`%"sessionID":"${sessionID}"%`]
    );

    return rows.map((row) => ({
      ...row,
      tags: row.tags ? String(row.tags).split(",") : [],
      metadata: row.metadata ? (parseMetadata(String(row.metadata)) ?? {}) : {},
    }));
  }

  async countVectors(db: TursoDb, containerTag: string): Promise<number> {
    const row = await db.get(`SELECT COUNT(*) as count FROM memories WHERE container_tag = ?`, [
      containerTag,
    ]);
    return Number(row?.count ?? 0);
  }

  async countAllVectors(db: TursoDb): Promise<number> {
    const row = await db.get(`SELECT COUNT(*) as count FROM memories`);
    return Number(row?.count ?? 0);
  }

  async getDistinctTags(db: TursoDb): Promise<Record<string, unknown>[]> {
    return db.all(`
      SELECT DISTINCT
        container_tag,
        display_name,
        user_name,
        user_email,
        project_path,
        project_name,
        git_repo_url
      FROM memories
    `);
  }

  async getProjectPathCounts(
    db: TursoDb
  ): Promise<Array<{ projectPath: string; count: number; containerTag: string | null }>> {
    const rows = await db.all(`
      SELECT
        project_path AS project_path,
        container_tag AS container_tag,
        COUNT(*) AS cnt
      FROM memories
      WHERE project_path IS NOT NULL AND project_path != ''
      GROUP BY project_path, container_tag
      ORDER BY cnt DESC, project_path ASC
    `);
    return rows.map((row) => ({
      projectPath: String(row.project_path),
      count: Number(row.cnt ?? 0),
      containerTag: row.container_tag ? String(row.container_tag) : null,
    }));
  }

  async updateProjectAssociation(
    db: TursoDb,
    oldContainerTag: string,
    update: {
      containerTag: string;
      projectPath?: string;
      projectName?: string;
      displayName?: string;
      gitRepoUrl?: string | null;
    }
  ): Promise<number> {
    return db.run(
      `
      UPDATE memories SET
        container_tag = ?,
        project_path = ?,
        project_name = ?,
        display_name = ?,
        git_repo_url = ?
      WHERE container_tag = ?
    `,
      [
        update.containerTag,
        update.projectPath ?? null,
        update.projectName ?? null,
        update.displayName ?? null,
        update.gitRepoUrl ?? null,
        oldContainerTag,
      ]
    );
  }

  async pinMemory(db: TursoDb, memoryId: string): Promise<void> {
    await db.run(`UPDATE memories SET is_pinned = 1 WHERE id = ?`, [memoryId]);
  }

  async unpinMemory(db: TursoDb, memoryId: string): Promise<void> {
    await db.run(`UPDATE memories SET is_pinned = 0 WHERE id = ?`, [memoryId]);
  }
}

export const tursoVectorSearch = new TursoVectorSearch();
