import { afterEach, describe, expect, it } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotDatabase } from "../src/services/storage/snapshot.js";
import { removeTestDir } from "./turso-test-utils.js";

// A shard copy must pass libSQL's full integrity_check (TDR-088). Plain `VACUUM INTO` copies the
// vector index metadata row twice, so the copy failed with "row not in PRIMARY KEY order".

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await removeTestDir(folder);
});

const TOP_K =
  "SELECT memories.id FROM vector_top_k('memories_vec_idx', vector('[5, 1, 2, 0.5]'), 5) AS hit " +
  "JOIN memories ON memories.rowid = hit.id";

async function withClient<T>(path: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = createClient({ url: `file:${path}` });
  try {
    return await run(client);
  } finally {
    client.close();
  }
}

async function makeVectorShard(path: string): Promise<void> {
  await withClient(path, async (client) => {
    await client.execute(
      "CREATE TABLE memories (id TEXT PRIMARY KEY, vector F32_BLOB(4), tags_vector F32_BLOB(4))"
    );
    // Two vector indexes, as in a real shard: the copy then holds four metadata rows out of order.
    await client.execute(
      "CREATE INDEX memories_vec_idx ON memories " +
        "(libsql_vector_idx(vector, 'compress_neighbors=float8'))"
    );
    await client.execute(
      "CREATE INDEX memories_tags_vec_idx ON memories " +
        "(libsql_vector_idx(tags_vector, 'compress_neighbors=float8')) " +
        "WHERE tags_vector IS NOT NULL"
    );
    for (let i = 0; i < 20; i++) {
      await client.execute({
        sql: "INSERT INTO memories VALUES (?, vector(?), vector(?))",
        args: [`m${i}`, `[${i}, 1, ${i % 3}, 0.5]`, `[1, ${i % 4}, 0, 1]`],
      });
    }
  });
}

async function readShard(path: string) {
  return withClient(path, async (client) => ({
    integrity: (await client.execute("PRAGMA integrity_check")).rows.map((row) => String(row[0])),
    ids: (await client.execute("SELECT id FROM memories ORDER BY id")).rows.map((row) =>
      String(row.id)
    ),
    nearest: (await client.execute(TOP_K)).rows.map((row) => String(row.id)),
  }));
}

describe("snapshotDatabase on a vector-indexed shard", () => {
  it("gives a copy that passes integrity_check, keeps every row and finds the same neighbours", async () => {
    const folder = mkdtempSync(join(tmpdir(), "omms-snapshot-integrity-"));
    folders.push(folder);
    const source = join(folder, "shard.db");
    const copy = join(folder, "copy.db");
    await makeVectorShard(source);
    const sourceBytes = createHash("sha256").update(readFileSync(source)).digest("hex");

    await snapshotDatabase(source, copy);

    const original = await readShard(source);
    const snapshot = await readShard(copy);
    expect(original.integrity).toEqual(["ok"]);
    expect(snapshot.integrity).toEqual(["ok"]);
    expect(snapshot.ids).toHaveLength(20);
    expect(snapshot.ids).toEqual(original.ids);
    expect(snapshot.nearest).toHaveLength(5);
    expect(snapshot.nearest).toEqual(original.nearest);
    expect(createHash("sha256").update(readFileSync(source)).digest("hex")).toBe(sourceBytes);
  });
});
