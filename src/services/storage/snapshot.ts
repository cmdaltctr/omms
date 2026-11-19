import { createClient } from "@libsql/client";

/**
 * Writes a consistent copy of the SQLite file `source` to `destination` with `VACUUM INTO`.
 * The copy is one snapshot even while other connections write, and needs no -wal or -shm file.
 */
export async function snapshotDatabase(source: string, destination: string): Promise<void> {
  const client = createClient({ url: `file:${source}` });
  try {
    await client.execute("PRAGMA busy_timeout = 5000");
    await client.execute({ sql: "VACUUM INTO ?", args: [destination] });
  } finally {
    client.close();
  }
}
