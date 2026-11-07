import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { cleanupTursoTestDirectory, removeTestDir } from "./turso-test-utils.js";

const PROJECT_HASH_ONE = "aaaaaaaaaaaaaaaa";
const PROJECT_HASH_TWO = "bbbbbbbbbbbbbbbb";
const USER_HASH = "cccccccccccccccc";
const PROJECT_TAG_ONE = `omms_project_${PROJECT_HASH_ONE}`;
const USER_TAG = `omms_user_${USER_HASH}`;
/** Distinct texts, so the tag+text duplicate rule only bites where a test says. */
const TEXT_ONE = "probe project memory one";
const TEXT_TWO = "probe user memory two";
const TEXT_THREE = "probe old memory three";
const TEXT_FOUR = "probe second project memory four";
const TEXT_BETA = "probe beta own memory";
const ALL_PROBE_TEXTS = [TEXT_ONE, TEXT_TWO, TEXT_THREE, TEXT_FOUR, TEXT_BETA];
const WHOLE_RANGE = { since: 10_000, until: 40_000 };

/** SHA-256 of every file under `folder`, keyed by its path relative to the folder. */
function hashFolder(folder: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        hashes.set(
          relative(folder, full),
          createHash("sha256").update(readFileSync(full)).digest("hex")
        );
      }
    }
  };
  walk(folder);
  return hashes;
}

interface SeedRow {
  id: string;
  text: string;
  scope: "user" | "project";
  hash: string;
  createdAt: number;
  tags?: string;
  type?: string;
  pinned?: boolean;
  metadata?: string;
  projectName?: string;
}

async function seed(folder: string, rows: SeedRow[]): Promise<void> {
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const store = openSpaceStore(folder, "write");
  try {
    for (const row of rows) {
      const shard = await store.shards.getWriteShard(row.scope, row.hash);
      const db = await store.connections.getConnection(shard.dbPath);
      await tursoVectorSearch.insertVector(db, {
        id: row.id,
        content: row.text,
        vector: new Float32Array([1, 0, 0, 0]),
        // A tags vector travels with tags; without one the engine embeds the
        // tags text again, which the reuse assertions do not expect.
        tagsVector: row.tags ? new Float32Array([0, 1, 0, 0]) : undefined,
        containerTag: `omms_${row.scope}_${row.hash}`,
        tags: row.tags,
        type: row.type,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
        metadata: row.metadata,
        projectName: row.projectName,
      });
      if (row.pinned) {
        await db.run(`UPDATE memories SET is_pinned = 1 WHERE id = ?`, [row.id]);
      }
      await store.shards.incrementVectorCount(shard.id);
    }
  } finally {
    await store.close();
  }
}

/** The rows a test fixture always seeds in the alpha space. */
function alphaRows(): SeedRow[] {
  return [
    {
      id: "a-one",
      text: TEXT_ONE,
      scope: "project",
      hash: PROJECT_HASH_ONE,
      createdAt: 10_000,
      tags: "alpha,first",
      type: "note",
      pinned: true,
      metadata: '{"origin":"alpha"}',
      projectName: "Alpha Project",
    },
    {
      id: "a-two",
      text: TEXT_TWO,
      scope: "user",
      hash: USER_HASH,
      createdAt: 20_000,
      tags: "personal",
    },
    {
      id: "a-three",
      text: TEXT_THREE,
      scope: "project",
      hash: PROJECT_HASH_ONE,
      createdAt: 5_000,
    },
    {
      id: "a-four",
      text: TEXT_FOUR,
      scope: "project",
      hash: PROJECT_HASH_TWO,
      createdAt: 30_000,
      pinned: true,
      projectName: "Second Project",
    },
  ];
}

/** `a-one`'s tag and text again, so the beta space already holds that pair. */
function betaRows(): SeedRow[] {
  return [
    { id: "b-one", text: TEXT_BETA, scope: "project", hash: PROJECT_HASH_ONE, createdAt: 8_000 },
    { id: "dup-one", text: TEXT_ONE, scope: "project", hash: PROJECT_HASH_ONE, createdAt: 9_000 },
  ];
}

interface ReadRow {
  id: string;
  content: string;
  containerTag: string;
  tags: string | null;
  type: string | null;
  createdAt: number;
  pinned: number;
  vectorJson: string | null;
}

async function readAllRows(folder: string): Promise<ReadRow[]> {
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const store = openSpaceStore(folder, "read");
  try {
    const rows: ReadRow[] = [];
    for (const scope of ["user", "project"] as const) {
      for (const shard of await store.listShards(scope, "")) {
        const db = await store.openShard(shard.dbPath);
        const raw = await db.all(`
          SELECT id, content, container_tag, tags, type, created_at, is_pinned,
                 vector_extract(vector) AS vector_json
          FROM memories
        `);
        for (const item of raw) {
          rows.push({
            id: String(item.id),
            content: String(item.content),
            containerTag: String(item.container_tag),
            tags: item.tags === null ? null : String(item.tags),
            type: item.type === null ? null : String(item.type),
            createdAt: Number(item.created_at),
            pinned: Number(item.is_pinned),
            vectorJson: item.vector_json === null ? null : String(item.vector_json),
          });
        }
      }
    }
    return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  } finally {
    await store.close();
  }
}

/** The registered `scope:hash` to `vector_count` pairs of a space's metadata.db. */
async function shardCounts(folder: string): Promise<Map<string, number>> {
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const store = openSpaceStore(folder, "read");
  try {
    const counts = new Map<string, number>();
    for (const scope of ["user", "project"] as const) {
      for (const shard of await store.listShards(scope, "")) {
        counts.set(`${shard.scope}:${shard.scopeHash}`, shard.vectorCount);
      }
    }
    return counts;
  } finally {
    await store.close();
  }
}

function logSize(): number {
  const file = process.env.OMMS_LOG_FILE;
  if (!file || !existsSync(file)) return 0;
  return statSync(file).size;
}

/** The log text appended since `before`, so assertions see only this call's records. */
function readNewLog(before: number): string {
  const file = process.env.OMMS_LOG_FILE;
  if (!file || !existsSync(file)) return "";
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const length = Math.max(0, size - before);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, before);
    return buffer.toString("utf-8");
  } finally {
    closeSync(fd);
  }
}

describe("space transfer service", () => {
  let tmp = "";
  let alphaFolder = "";
  let betaFolder = "";
  let embedCalls = 0;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "space-transfer-service-"));
    alphaFolder = join(tmp, "spaces", "alpha");
    betaFolder = join(tmp, "spaces", "beta");
    mkdirSync(alphaFolder, { recursive: true });
    mkdirSync(betaFolder, { recursive: true });
    writeFileSync(
      join(tmp, "spaces.json"),
      `${JSON.stringify(
        {
          version: 1,
          activeSpaceId: "default",
          spaces: [
            { id: "alpha", name: "Alpha", createdAt: "2026-01-01T00:00:00.000Z", archived: false },
            { id: "beta", name: "Beta", createdAt: "2026-01-02T00:00:00.000Z", archived: false },
            {
              id: "arch",
              name: "Old Project",
              createdAt: "2026-01-03T00:00:00.000Z",
              archived: true,
              archivedAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        },
        null,
        2
      )}\n`
    );
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = join(tmp, "default-store");
    // The shard init records these, so the seeded shards prove vector reuse.
    CONFIG.embeddingModel = "Xenova/nomic-embed-text-v1";
    CONFIG.embeddingDimensions = 4;
    embedCalls = 0;
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory();
    if (tmp) await removeTestDir(tmp);
  });

  /** The service context of every test: real paths, a recording embed stub. */
  async function makeContext() {
    const { spaceFiles } = await import("../src/services/spaces/registry-store.js");
    return {
      files: spaceFiles(tmp),
      paths: { globalStoragePath: join(tmp, "default-store"), spacesRoot: join(tmp, "spaces") },
      embedding: { model: "Xenova/nomic-embed-text-v1", dimensions: 4 },
      maxVectorsPerShard: 100,
      embed: async () => {
        embedCalls++;
        return new Float32Array([0.5, 0.5, 0.5, 0.5]);
      },
    };
  }

  async function preview(from: string, to: string, filter = WHOLE_RANGE) {
    const service = await import("../src/services/spaces/transfer-service.js");
    return service.previewSpaceTransfer({ from, to, filter }, await makeContext());
  }

  async function apply(
    from: string,
    to: string,
    mode: "copy" | "move",
    filter = WHOLE_RANGE,
    previewMatched?: number
  ) {
    const service = await import("../src/services/spaces/transfer-service.js");
    return service.applySpaceTransfer(
      {
        from,
        to,
        filter,
        mode,
        ...(previewMatched === undefined ? {} : { previewMatched }),
      },
      await makeContext()
    );
  }

  it("refuses an unknown space, naming it", async () => {
    const outcome = await preview("gamma", "beta");
    expect(outcome).toMatchObject({ ok: false, code: "unknown-space" });
    if (!outcome.ok) expect(outcome.error).toContain("gamma");
  });

  it("refuses a transfer inside one space, for the Default space too", async () => {
    expect(await preview("alpha", "Alpha")).toMatchObject({ ok: false, code: "same-space" });
    expect(await preview("default", "Default")).toMatchObject({ ok: false, code: "same-space" });
  });

  it("refuses an archived source or target, naming the space", async () => {
    const source = await preview("arch", "beta");
    expect(source).toMatchObject({ ok: false, code: "archived-space" });
    if (!source.ok) expect(source.error).toContain("Old Project");
    const target = await apply("alpha", "arch", "copy");
    expect(target).toMatchObject({ ok: false, code: "archived-space" });
    if (!target.ok) expect(target.error).toContain("Old Project");
  });

  it("refuses the transfer when spaces.json is unusable", async () => {
    writeFileSync(join(tmp, "spaces.json"), `{"activeSpaceId":"ghost","spaces":[]}`);
    expect(await preview("alpha", "beta")).toMatchObject({ ok: false, code: "registry-problem" });
  });

  it("previews counts, groups and examples without touching either space", async () => {
    await seed(alphaFolder, alphaRows());
    await seed(betaFolder, betaRows());

    const alphaBefore = hashFolder(alphaFolder);
    const betaBefore = hashFolder(betaFolder);
    const logBefore = logSize();

    const outcome = await preview("alpha", "beta");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.preview.matched).toBe(3);
    expect(outcome.preview.duplicates).toBe(1);
    expect(outcome.preview.toCopy).toBe(2);
    // Groups count the rows a copy would write; a-one is a duplicate, so its
    // project group does not appear.
    expect(outcome.preview.groups.map((group) => [group.name, group.count]).sort()).toEqual([
      ["Personal", 1],
      ["Second Project", 1],
    ]);
    // Examples come from the rows a copy would write, so the duplicate is out.
    expect(outcome.preview.examples.length).toBe(2);

    expect(hashFolder(alphaFolder)).toEqual(alphaBefore);
    expect(hashFolder(betaFolder)).toEqual(betaBefore);

    const logged = readNewLog(logBefore);
    expect(logged).toContain("alpha");
    expect(logged).toContain("beta");
    expect(logged).toContain('"matched":3');
    for (const text of ALL_PROBE_TEXTS) expect(logged).not.toContain(text);
  });

  it("previews into a space that has no folder yet and creates nothing", async () => {
    await seed(alphaFolder, alphaRows());
    rmSync(betaFolder, { recursive: true, force: true });

    const outcome = await preview("alpha", "beta");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.preview.matched).toBe(3);
    expect(outcome.preview.duplicates).toBe(0);
    expect(outcome.preview.toCopy).toBe(3);
    expect(existsSync(betaFolder)).toBe(false);
  });

  it("narrows the preview by date range and by project tag", async () => {
    await seed(alphaFolder, alphaRows());
    await seed(betaFolder, betaRows());

    const byDate = await preview("alpha", "beta", { since: 15_000, until: 25_000 });
    expect(byDate.ok).toBe(true);
    if (byDate.ok) {
      expect(byDate.preview.matched).toBe(1);
      expect(byDate.preview.duplicates).toBe(0);
      expect(byDate.preview.toCopy).toBe(1);
    }

    const byProject = await preview("alpha", "beta", {
      since: 10_000,
      until: 40_000,
      projectTag: PROJECT_TAG_ONE,
    });
    expect(byProject.ok).toBe(true);
    if (byProject.ok) {
      expect(byProject.preview.matched).toBe(1);
      expect(byProject.preview.duplicates).toBe(1);
      expect(byProject.preview.toCopy).toBe(0);
    }
  });

  it("copies rows with fields and vectors intact and leaves the source untouched", async () => {
    await seed(alphaFolder, alphaRows());
    await seed(betaFolder, betaRows());
    const alphaBefore = hashFolder(alphaFolder);
    const logBefore = logSize();

    const outcome = await apply("alpha", "beta", "copy");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toMatchObject({
      ok: true,
      mode: "copy",
      copied: 2,
      skipped: 1,
      removed: 0,
      embeddedAgain: false,
      missingIds: [],
    });

    // A transfer between two spaces that are not active never switches the active space.
    expect(JSON.parse(readFileSync(join(tmp, "spaces.json"), "utf-8")).activeSpaceId).toBe(
      "default"
    );

    const rows = await readAllRows(betaFolder);
    expect(rows.map((row) => row.id)).toEqual(["a-four", "a-two", "b-one", "dup-one"]);
    const copied = rows.find((row) => row.id === "a-two")!;
    expect(copied.content).toBe(TEXT_TWO);
    expect(copied.containerTag).toBe(USER_TAG);
    expect(copied.tags).toBe("personal");
    expect(copied.createdAt).toBe(20_000);
    expect(JSON.parse(copied.vectorJson ?? "[]")).toEqual([1, 0, 0, 0]);
    const pinned = rows.find((row) => row.id === "a-four")!;
    expect(pinned.pinned).toBe(1);

    expect(
      new Map([
        ["project:aaaaaaaaaaaaaaaa", 2],
        ["user:cccccccccccccccc", 1],
        ["project:bbbbbbbbbbbbbbbb", 1],
      ])
    ).toEqual(await shardCounts(betaFolder));

    // Vectors were reused, so nothing was embedded again.
    expect(embedCalls).toBe(0);
    expect(hashFolder(alphaFolder)).toEqual(alphaBefore);

    const logged = readNewLog(logBefore);
    expect(logged).toContain('"copied":2');
    expect(logged).toContain("alpha");
    expect(logged).toContain("beta");
    for (const text of ALL_PROBE_TEXTS) expect(logged).not.toContain(text);
  });

  it("skips everything when the same copy runs a second time", async () => {
    await seed(alphaFolder, alphaRows());
    await seed(betaFolder, betaRows());
    await apply("alpha", "beta", "copy");

    const again = await apply("alpha", "beta", "copy");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.result).toMatchObject({ ok: true, copied: 0, skipped: 3, removed: 0 });
    expect(embedCalls).toBe(0);
  });

  it("moves rows: the source keeps what a copy would skip", async () => {
    await seed(alphaFolder, alphaRows());
    await seed(betaFolder, betaRows());
    const logBefore = logSize();

    const outcome = await apply("alpha", "beta", "move");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toMatchObject({
      ok: true,
      mode: "move",
      copied: 2,
      skipped: 1,
      removed: 2,
      embeddedAgain: false,
      missingIds: [],
    });

    // a-one stays (the target already held its tag+text pair); a-three sits outside the range.
    expect((await readAllRows(alphaFolder)).map((row) => row.id)).toEqual(["a-one", "a-three"]);
    expect((await readAllRows(betaFolder)).map((row) => row.id)).toEqual([
      "a-four",
      "a-two",
      "b-one",
      "dup-one",
    ]);
    expect(await shardCounts(alphaFolder)).toEqual(
      new Map([
        ["project:aaaaaaaaaaaaaaaa", 2],
        ["user:cccccccccccccccc", 0],
        ["project:bbbbbbbbbbbbbbbb", 0],
      ])
    );

    const logged = readNewLog(logBefore);
    expect(logged).toContain('"removed":2');
    for (const text of ALL_PROBE_TEXTS) expect(logged).not.toContain(text);
  });

  it("reports how many rows changed between the preview and the apply", async () => {
    await seed(alphaFolder, alphaRows());
    await seed(betaFolder, betaRows());

    const outcome = await apply("alpha", "beta", "copy", WHOLE_RANGE, 99);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.changedFromPreview).toBe(-96);
  });

  it("embeds again when the source shard records no embedding model", async () => {
    await seed(alphaFolder, alphaRows());
    await seed(betaFolder, betaRows());
    const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
    const store = openSpaceStore(alphaFolder, "write");
    try {
      for (const scope of ["user", "project"] as const) {
        for (const shard of await store.shards.getAllShards(scope, "")) {
          const db = await store.connections.getConnection(shard.dbPath);
          await db.run(`DELETE FROM shard_metadata WHERE key = 'embedding_model'`);
        }
      }
    } finally {
      await store.close();
    }

    const outcome = await apply("alpha", "beta", "copy");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.embeddedAgain).toBe(true);
      expect(outcome.result.copied).toBe(2);
    }
    expect(embedCalls).toBeGreaterThan(0);
  });

  it("logs a refusal with its code and no memory text", async () => {
    await seed(alphaFolder, alphaRows());
    const logBefore = logSize();
    await apply("arch", "beta", "copy");
    const logged = readNewLog(logBefore);
    expect(logged).toContain("archived-space");
    expect(logged).toContain("arch");
    for (const text of ALL_PROBE_TEXTS) expect(logged).not.toContain(text);
  });
});
