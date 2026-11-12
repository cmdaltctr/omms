import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { memoryQueries } from "./memory-sql-scan.js";

const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");

interface AllowedReader {
  file: string;
  /** The query text with whitespace collapsed and each `${...}` shown as `${…}`. */
  sql: string;
  /** Why this reader is kind-neutral by design. */
  why: string;
}

/**
 * SQL that reads the memories table without a record-kind predicate, on purpose.
 * Each entry names the exact query. A changed query, or a new one, fails the guard
 * until a person reads it and either adds the predicate or adds an entry here.
 * Allowed groups: by-ID reads and deletes, row counts, migrations, export and
 * backup, space transfer, and dedup by ID or by content.
 */
const ALLOWED: AllowedReader[] = [
  {
    file: "src/importer/importer.ts",
    sql: "SELECT id FROM memories WHERE metadata LIKE ? ESCAPE '\\\\'",
    why: "Dedup by import ID. An import never writes a memorisation, so none carries an importId.",
  },
  {
    file: "src/services/chat/chat-runtime.ts",
    sql: "SELECT id FROM memories WHERE id IN (${\u2026})",
    why: "By-ID existence check for memory IDs the chat cited. By-ID reads are kind-neutral.",
  },
  {
    file: "src/services/spaces/export-space.ts",
    sql: "SELECT ${\u2026} FROM memories",
    why: "Space export and backup copy every row of every kind.",
  },
  {
    file: "src/services/spaces/transfer-service.ts",
    sql: "SELECT id, content, container_tag, tags, type, created_at, updated_at, metadata, project_name, is_pinned, vector_extract(vector) AS vector_json, CASE WHEN tags_vector IS NULL THEN NULL ELSE vector_extract(tags_vector) END AS tags_vector_json FROM memories WHERE created_at >= ? AND created_at <= ?${\u2026}",
    why: "Space transfer copies whole rows of every kind, so a memorisation keeps its type.",
  },
  {
    file: "src/services/spaces/transfer-service.ts",
    sql: "SELECT id FROM memories",
    why: "Dedup by ID in the target space, across every kind.",
  },
  {
    file: "src/services/spaces/transfer-service.ts",
    sql: "SELECT id FROM memories WHERE id IN (${\u2026})",
    why: "Dedup by ID in the target space, across every kind.",
  },
  {
    file: "src/services/spaces/transfer-service.ts",
    sql: "SELECT container_tag, content FROM memories",
    why: "Dedup by tag and content in the target space, across every kind.",
  },
  {
    file: "src/services/spaces/transfer-service.ts",
    sql: "DELETE FROM memories WHERE id IN (${\u2026})",
    why: "A space move removes the source rows it copied, by ID.",
  },
  {
    file: "src/services/turso/shard-manager.ts",
    sql: "SELECT COUNT(*) as count FROM memories",
    why: "Shard row-count bookkeeping counts every row.",
  },
  {
    file: "src/services/turso/vector-search.ts",
    sql: "DELETE FROM memories WHERE id = ?",
    why: "Delete by ID. The Memorisation page deletes through this path.",
  },
  {
    file: "src/services/turso/vector-search.ts",
    sql: "SELECT id, content, container_tag, created_at, vector_extract(vector) AS vector_json FROM memories ORDER BY created_at DESC",
    why: "No caller in src/. Only tests/turso-dedup-extract.test.ts calls it. Dedup uses its own filtered query. Left as is.",
  },
  {
    file: "src/services/turso/vector-search.ts",
    sql: "SELECT * FROM memories WHERE id = ?",
    why: "By-ID read. Recall by ID and the Memorisation page rely on it.",
  },
  {
    file: "src/services/turso/vector-search.ts",
    sql: "SELECT COUNT(*) as count FROM memories WHERE container_tag = ?",
    why: "Row count for shard bookkeeping.",
  },
  {
    file: "src/services/turso/vector-search.ts",
    sql: "SELECT COUNT(*) as count FROM memories",
    why: "Row count for shard bookkeeping and migrations.",
  },
  {
    file: "src/services/turso/vector-search.ts",
    sql: "SELECT DISTINCT container_tag, display_name, user_name, user_email, project_path, project_name, git_repo_url FROM memories",
    why: "Lists project tags. Memorisations share the project tag, so they add no tag.",
  },
  {
    file: "src/services/turso/vector-search.ts",
    sql: "SELECT project_path AS project_path, container_tag AS container_tag, COUNT(*) AS cnt FROM memories WHERE project_path IS NOT NULL AND project_path != '' GROUP BY project_path, container_tag ORDER BY cnt DESC, project_path ASC",
    why: "Shard inventory counts every row.",
  },
  {
    file: "src/services/turso/keyword-search.ts",
    sql: "SELECT (SELECT COUNT(*) FROM memories_fts_docsize) AS indexed, (SELECT COUNT(*) FROM memories) AS stored",
    why: "Index health check compares the FTS row count with the table row count.",
  },
  {
    file: "src/services/turso/legacy-migrator.ts",
    sql: "SELECT COUNT(*) as count FROM memories",
    why: "Legacy store migration reads every row.",
  },
  {
    file: "src/services/turso/legacy-migrator.ts",
    sql: "SELECT vector_extract(vector) AS extracted FROM memories LIMIT 1",
    why: "Legacy store migration probes a row.",
  },
  {
    file: "src/services/turso/legacy-migrator.ts",
    sql: "SELECT * FROM memories",
    why: "Legacy store migration reads every row.",
  },
  {
    file: "src/services/cleanup-service.ts",
    sql: "SELECT id FROM memories WHERE is_pinned = 1",
    why: "Collects pinned IDs to protect them from cleanup. It only protects, so kind-neutral is safe.",
  },
  {
    file: "src/services/tag-prefix-scan.ts",
    sql: "SELECT COUNT(*) as count FROM memories WHERE container_tag LIKE ? ESCAPE '\\\\'",
    why: "Tag prefix migration scan counts every row.",
  },
  {
    file: "src/services/tag-prefix-migration.ts",
    sql: "SELECT COUNT(*) as count FROM memories WHERE container_tag LIKE ? ESCAPE '\\\\'",
    why: "Tag prefix migration counts every row.",
  },
  {
    file: "src/services/tag-prefix-migration.ts",
    sql: "SELECT id FROM memories",
    why: "Tag prefix migration lists every row ID.",
  },
  {
    file: "src/services/tag-prefix-migration.ts",
    sql: "SELECT COUNT(*) as count FROM memories",
    why: "Tag prefix migration verification count.",
  },
  {
    file: "src/services/tag-prefix-migration.ts",
    sql: "SELECT COUNT(*) as count FROM memories",
    why: "Tag prefix migration verification count.",
  },
  {
    file: "src/services/api-handlers.ts",
    sql: "DELETE FROM memories WHERE id = ?",
    why: "Delete by ID inside the update transaction. handleUpdateMemory refuses memorisations before it gets here.",
  },
  {
    file: "src/services/tag-migration.ts",
    sql: "SELECT * FROM memories WHERE id = ?",
    why: "By-ID read for the tag backfill. The queue holds only IDs from the filtered untagged query.",
  },
  {
    file: "src/services/memory-replace.ts",
    sql: "DELETE FROM memories WHERE id = ?",
    why: "Delete by ID inside the replace transaction. Replace is how a memorisation changes.",
  },
  {
    file: "src/services/migration-service.ts",
    sql: "SELECT id, content, container_tag, tags, type, created_at, updated_at, metadata, display_name, user_name, user_email, project_path, project_name, git_repo_url, is_pinned FROM memories ORDER BY created_at DESC",
    why: "Store migration reads every row.",
  },
  {
    file: "src/services/migration-service.ts",
    sql: "SELECT COUNT(*) AS count FROM memories",
    why: "Store migration verification count.",
  },
  {
    file: "src/services/linked-search.ts",
    sql: "SELECT id FROM memories WHERE id = ?",
    why: "By-ID read for the memorisation lookup in linked spaces.",
  },
  {
    file: "src/services/linked-search.ts",
    sql: "SELECT * FROM memories WHERE id = ? AND (? IS NULL OR container_tag = ?)",
    why: "By-ID read for the memorisation lookup in linked spaces.",
  },
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** Every SQL literal in src/ that reads the memories table. */
function allQueries() {
  const found: Array<{ file: string; line: number; sql: string; filtered: boolean }> = [];
  for (const path of sourceFiles(join(root, "src"))) {
    // Allow-list entries use "/" paths; Windows gives "\\" from relative().
    const file = relative(root, path).split(sep).join("/");
    const { queries, clean } = memoryQueries(readFileSync(path, "utf8"));
    expect(clean, `${file} tokenises cleanly`).toBe(true);
    for (const query of queries) found.push({ file, ...query });
  }
  return found;
}

describe("memorisation kind SQL guard", () => {
  it("requires a kind predicate in every src/ query that reads the memories table", () => {
    const unused = [...ALLOWED];
    const unfiltered: string[] = [];
    for (const query of allQueries()) {
      if (query.filtered) continue;
      const index = unused.findIndex(
        (entry) => entry.file === query.file && entry.sql === query.sql
      );
      if (index >= 0) unused.splice(index, 1);
      else unfiltered.push(`${query.file}:${query.line}  ${query.sql.slice(0, 120)}`);
    }
    expect(unfiltered, "queries without a kind predicate or an allow-list entry").toEqual([]);
    expect(
      unused.map((entry) => `${entry.file}  ${entry.sql.slice(0, 120)}`),
      "allow-list entries that match no query"
    ).toEqual([]);
  });

  it("finds the queries it guards", () => {
    const queries = allQueries();
    expect(queries.length).toBeGreaterThan(40);
    expect(queries.filter((query) => query.filtered).length).toBeGreaterThan(10);
    for (const file of ["vector-search.ts", "exact-scan.ts", "keyword-search.ts"]) {
      expect(queries.some((query) => query.file.endsWith(file) && query.filtered)).toBe(true);
    }
  });

  it("explains every allow-list entry", () => {
    for (const entry of ALLOWED) expect(entry.why.length, entry.sql).toBeGreaterThan(20);
  });

  it("keeps the linked readers on the kind-filtered storage methods", () => {
    for (const input of ["searchLinkedSpaces", "listLinkedSpaces"]) {
      const text = source("src/services/linked-search.ts");
      const offset = text.indexOf(`export async function ${input}`);
      expect(offset, `${input} exists`).toBeGreaterThanOrEqual(0);
      const next = text.indexOf("\nexport ", offset + 1);
      expect(text.slice(offset, next === -1 ? undefined : next)).toContain(
        'input.kind ?? "normal"'
      );
    }
  });
});

describe("memory SQL scanner", () => {
  const scan = (code: string) => memoryQueries(code).queries;

  it("flags an unfiltered reader", () => {
    expect(scan("db.all(`SELECT * FROM memories WHERE tags = ?`)")).toMatchObject([
      { filtered: false },
    ]);
  });

  it("accepts each form of the kind predicate", () => {
    for (const predicate of [
      "${memoryKindPredicate()}",
      "${UNTAGGED_NORMAL_PREDICATE}",
      "type IS NOT 'memorisation'",
      "type = 'memorisation'",
    ]) {
      expect(scan(`db.all(\`SELECT * FROM memories WHERE ${predicate}\`)`)).toMatchObject([
        { filtered: true },
      ]);
    }
  });

  it("reads JOIN memories and quoted strings", () => {
    expect(scan('db.all("SELECT m.id FROM x JOIN memories m ON m.rowid = x.id")')).toHaveLength(1);
  });

  it("ignores prose in comments", () => {
    expect(scan("// SELECT * FROM memories\n/** reads from memories */\nconst a = 1;")).toEqual([]);
  });

  it("does not count other tables that start with memories", () => {
    expect(scan("db.all(`SELECT 1 FROM memories_fts`)")).toEqual([]);
  });

  it("survives a regex with a quote and a nested template", () => {
    const code = "const r = /'/g;\ndb.all(`SELECT * FROM memories WHERE ${a ? `x` : ''}`);";
    expect(scan(code)).toMatchObject([{ filtered: false }]);
    expect(memoryQueries(code).clean).toBe(true);
  });
});
