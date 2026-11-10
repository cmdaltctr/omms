import type { TursoDb } from "./turso-db.js";
import { distanceToSimilarity } from "./vector-utils.js";
import { memoryKindPredicate, type MemoryKind } from "../memory-kind.js";

/** Exact (non-indexed) nearest-neighbour scan, used when `vector_top_k` fails. */
export async function exactScanKind(
  db: TursoDb,
  queryJson: string,
  k: number,
  containerTag: string,
  columnName: string,
  kind: MemoryKind = "normal"
): Promise<Array<{ id: string; similarity: number }>> {
  const rows = await db.all(
    containerTag === ""
      ? `
      SELECT m.id AS id, vector_distance_cos(m.${columnName}, vector32(?)) AS dist
      FROM memories m
      WHERE m.${columnName} IS NOT NULL AND ${memoryKindPredicate("m.type", kind)}
      ORDER BY dist ASC
      LIMIT ?
    `
      : `
      SELECT m.id AS id, vector_distance_cos(m.${columnName}, vector32(?)) AS dist
      FROM memories m
      WHERE m.${columnName} IS NOT NULL AND m.container_tag = ? AND ${memoryKindPredicate("m.type", kind)}
      ORDER BY dist ASC
      LIMIT ?
    `,
    containerTag === "" ? [queryJson, k] : [queryJson, containerTag, k]
  );

  return rows.map((row) => ({
    id: String(row.id),
    similarity: distanceToSimilarity(Number(row.dist)),
  }));
}
