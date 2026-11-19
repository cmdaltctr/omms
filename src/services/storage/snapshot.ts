import { createClient } from "@libsql/client";

/**
 * Writes a consistent copy of the SQLite file `source` to `destination` with `VACUUM INTO`.
 * The copy is one snapshot even while other connections write, and needs no -wal or -shm file.
 * Only the copy is repaired after the vacuum; the source is never written.
 */
export async function snapshotDatabase(source: string, destination: string): Promise<void> {
  const client = createClient({ url: `file:${source}` });
  try {
    await client.execute("PRAGMA busy_timeout = 5000");
    await client.execute({ sql: "VACUUM INTO ?", args: [destination] });
  } finally {
    client.close();
  }
  await dedupeVectorMeta(destination);
}

/**
 * libSQL's `VACUUM INTO` replays each vector index's CREATE INDEX, which writes its metadata row,
 * then copies the metadata table as well. The copy then holds every row twice and fails the full
 * integrity_check (TDR-088). The duplicate rows are identical, so this keeps one of each.
 * The rows are grouped in a plain temp table: a GROUP BY on the damaged table trusts its broken
 * key order and keeps duplicates when the shard has more than one vector index.
 */
async function dedupeVectorMeta(copy: string): Promise<void> {
  const client = createClient({ url: `file:${copy}` });
  try {
    const meta = await client.execute(
      "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'libsql_vector_meta_shadow'"
    );
    if (meta.rows.length === 0) return;
    await client.batch(
      [
        "CREATE TEMP TABLE vector_meta_once AS SELECT name, metadata FROM libsql_vector_meta_shadow",
        "DELETE FROM libsql_vector_meta_shadow",
        "INSERT INTO libsql_vector_meta_shadow " +
          "SELECT name, metadata FROM vector_meta_once GROUP BY name",
        "DROP TABLE vector_meta_once",
      ],
      "write"
    );
  } finally {
    client.close();
  }
}
