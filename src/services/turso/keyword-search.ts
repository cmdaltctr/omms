/**
 * Exact-word matching for memory search (openspec change
 * hook-search-keywords-and-profile). The pure parts take their settings as
 * arguments: do not import CONFIG here, many tests stub src/config.js.
 */
import { log } from "../logger.js";
import type { KeywordMode } from "../../utils/keyword-boost.js";
import type { TursoDb } from "./turso-db.js";

const MAX_TERMS = 24;

// Words that carry no search value. With the OR query below, one of them
// would pull most of a shard in as candidates.
const STOP_WORDS = new Set([
  "the",
  "and",
  "or",
  "not",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "is",
  "it",
  "an",
  "be",
  "are",
  "was",
  "we",
  "i",
  "me",
  "my",
  "you",
  "do",
  "did",
  "does",
  "why",
  "how",
  "what",
  "with",
  "this",
  "that",
]);

/**
 * FTS5 query for the words of a prompt: lower-case terms from letters and
 * digits only ("ADR-023" gives `adr` and `023`), each in quotes, joined by OR.
 * Quoting and the character filter keep prompt text from becoming index
 * syntax. Returns null when no usable term is left.
 */
export function buildKeywordQuery(queryText: string | undefined): string | null {
  const terms = new Set<string>();
  for (const word of (queryText ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 2 || STOP_WORDS.has(word)) continue;
    terms.add(word);
    if (terms.size === MAX_TERMS) break;
  }
  if (terms.size === 0) return null;
  return [...terms].map((term) => `"${term}"`).join(" OR ");
}

/**
 * Similarity after the keyword boost: `base + keywordBoost × score ÷ best`,
 * where `score` is the memory's match strength and `best` the strongest in the
 * same search. The share is capped at 1 so the boost never passes
 * `keywordBoost`, and the result never passes 1.
 */
export function applyKeywordBoost(
  base: number,
  score: number,
  bestScore: number,
  keywordBoost: number
): number {
  if (!(keywordBoost > 0) || !(score > 0) || !(bestScore > 0)) return base;
  return Math.min(1, base + keywordBoost * Math.min(1, score / bestScore));
}

// The index is derived data: external content (no second copy of the text),
// kept in step by triggers, and rebuilt whenever it is missing or short.
const INDEX_OBJECTS = ["memories_fts", "memories_fts_ai", "memories_fts_ad", "memories_fts_au"];
const INDEX_SETUP = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
     content, tags, content='memories', content_rowid='rowid', tokenize='unicode61'
   )`,
  `CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
     INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
   END`,
  `CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
     INSERT INTO memories_fts(memories_fts, rowid, content, tags)
     VALUES ('delete', old.rowid, old.content, old.tags);
   END`,
  `CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE OF content, tags ON memories BEGIN
     INSERT INTO memories_fts(memories_fts, rowid, content, tags)
     VALUES ('delete', old.rowid, old.content, old.tags);
     INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
   END`,
];

async function indexIsCurrent(db: TursoDb): Promise<boolean> {
  const names = INDEX_OBJECTS.map(() => "?").join(",");
  const present = await db.all(`SELECT name FROM sqlite_schema WHERE name IN (${names})`, [
    ...INDEX_OBJECTS,
  ]);
  if (present.length !== INDEX_OBJECTS.length) return false;
  // COUNT(*) on an external-content table reads the memories table, so the
  // number of documents the index really holds comes from its docsize table.
  const row = await db.get<{ indexed: number; stored: number }>(
    `SELECT (SELECT COUNT(*) FROM memories_fts_docsize) AS indexed,
            (SELECT COUNT(*) FROM memories) AS stored`
  );
  return Number(row?.indexed) === Number(row?.stored);
}

/** Create or rebuild the keyword index of a shard. Idempotent. */
export async function ensureKeywordIndex(db: TursoDb): Promise<void> {
  if (await indexIsCurrent(db)) return;
  // One transaction: a failed rebuild leaves no triggers behind that would
  // write to a broken index on every save.
  await db.transaction("write", async (tx) => {
    for (const sql of INDEX_SETUP) await tx.execute(sql);
    await tx.execute(`INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')`);
  });
}

export interface KeywordHits {
  /** Match strength per memory id; higher is stronger. */
  scores: Map<string, number>;
  best: number;
}

/**
 * Memories of one shard that contain a word of the prompt, strongest first.
 * Returns null when there is nothing to match or the index fails: search then
 * continues with vector and tag results. The log holds a code and an error
 * name only, never the prompt or memory text.
 */
export async function searchKeywords(
  db: TursoDb,
  queryText: string | undefined,
  containerTag: string,
  limit: number
): Promise<KeywordHits | null> {
  const match = buildKeywordQuery(queryText);
  if (!match) return null;
  try {
    await ensureKeywordIndex(db);
    const rows = await db.all(
      `SELECT m.id AS id, -bm25(memories_fts) AS score
       FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
       WHERE memories_fts MATCH ?${containerTag === "" ? "" : " AND m.container_tag = ?"}
       ORDER BY score DESC LIMIT ?`,
      containerTag === "" ? [match, limit] : [match, containerTag, limit]
    );
    const scores = new Map(rows.map((row) => [String(row.id), Number(row.score)] as const));
    return { scores, best: Math.max(0, ...scores.values()) };
  } catch (error) {
    log(
      "Keyword search failed; using vector results",
      {
        code: "keyword_index_failed",
        error: error instanceof Error ? error.name : "unknown",
      },
      "warn"
    );
    return null;
  }
}

/**
 * `base` with the boost for memory `id`; `base` itself when it has no keyword hit
 * or the mode is `rrf` (rank fusion keeps each memory's own similarity).
 */
export function boostedSimilarity(
  base: number,
  hits: KeywordHits | null,
  id: string,
  keywordBoost: number,
  mode: KeywordMode = "boost"
): number {
  if (mode === "rrf") return base;
  return applyKeywordBoost(base, hits?.scores.get(id) ?? 0, hits?.best ?? 0, keywordBoost);
}
