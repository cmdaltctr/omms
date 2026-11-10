import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The Memorisation page API against the real store with real embeddings:
 * `GET /api/memorisations` (the list) and `GET /api/memorisations/recall?q=`.
 * Delete reuses `DELETE /api/memories/:id`, so one test checks that a
 * memorisation leaves the list after it.
 */

const OMMS = join(homedir(), ".omms");
const SPACES_ROOT = join(OMMS, "spaces");
const ALPHA = join(SPACES_ROOT, "alpha");
const BETA = join(SPACES_ROOT, "beta");
const tempDirs: string[] = [];

function useRegistry(alphaLinks: string[]): void {
  const entry = (id: string, name: string, links?: string[]) => ({
    id,
    name,
    createdAt: "2026-11-06T09:00:00.000Z",
    archived: false,
    ...(links && links.length > 0 ? { links } : {}),
  });
  mkdirSync(ALPHA, { recursive: true });
  mkdirSync(BETA, { recursive: true });
  writeFileSync(
    join(OMMS, "spaces.json"),
    `${JSON.stringify(
      {
        version: 1,
        activeSpaceId: "alpha",
        spaces: [entry("alpha", "Alpha", alphaLinks), entry("beta", "Beta")],
      },
      null,
      2
    )}\n`
  );
}

/** A project folder per test, so every test reads only its own rows. */
async function freshProject() {
  const directory = mkdtempSync(join(tmpdir(), "omms-memorisation-routes-"));
  tempDirs.push(directory);
  const { getTags } = await import("../src/services/tags.js");
  return { directory, tags: getTags(directory) };
}

async function operation(
  args: Record<string, unknown>,
  project: Awaited<ReturnType<typeof freshProject>>,
  hostSessionId?: string
): Promise<any> {
  const { executeMemoryOperation } = await import("../src/core/memory-operations.js");
  return executeMemoryOperation(args as any, {
    directory: project.directory,
    host: "pi",
    hostSessionId,
    tags: project.tags,
  });
}

/** What route registration builds from CONFIG, built here the same way. */
async function routeConfig() {
  const { CONFIG } = await import("../src/config.js");
  const { linkedSettingsFrom } = await import("../src/services/linked-search.js");
  return { defaultScope: CONFIG.memory.defaultScope, linked: linkedSettingsFrom(CONFIG) };
}

async function get(project: Awaited<ReturnType<typeof freshProject>>, path: string) {
  const { routeMemorisations } = await import("../src/services/memorisation-routes.js");
  const url = new URL(`http://localhost${path}`);
  return routeMemorisations(
    url.pathname,
    "GET",
    url,
    project.directory,
    await routeConfig()
  ) as Promise<{ status: number; body: any } | undefined>;
}

async function post(
  project: Awaited<ReturnType<typeof freshProject>>,
  path: string,
  body: unknown
) {
  const { routeMemorisations } = await import("../src/services/memorisation-routes.js");
  const url = new URL(`http://localhost${path}`);
  return routeMemorisations(
    url.pathname,
    "POST",
    url,
    project.directory,
    await routeConfig(),
    async () => body
  ) as Promise<{ status: number; body: any } | undefined>;
}

/**
 * Writes rows straight into the active space with a blank vector, so a test can seed
 * hundreds of rows without embedding each one. Search never sees them; lists do.
 */
async function seedRows(
  project: Awaited<ReturnType<typeof freshProject>>,
  rows: { id: string; content: string; type: string; tags: string; createdAt: number }[]
) {
  const { memoryClient } = await import("../src/services/client.js");
  const { CONFIG } = await import("../src/config.js");
  const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  await memoryClient.ensureStorageReady();
  const tag = project.tags.project.tag;
  const shard = await tursoShardManager.getWriteShard("project", tag.split("_").pop()!);
  const db = await tursoConnectionManager.getConnection(shard.dbPath);
  for (const row of rows) {
    await tursoVectorSearch.insertVector(db, {
      id: row.id,
      content: row.content,
      vector: new Float32Array(CONFIG.embeddingDimensions ?? 768),
      containerTag: tag,
      type: row.type as never,
      tags: row.tags,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
    });
    await tursoShardManager.incrementVectorCount(shard.id);
  }
}

async function writeLinkedMemorisation(id: string, text: string, tag: string) {
  const { embeddingService } = await import("../src/services/embedding.js");
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const store = openSpaceStore(BETA, "write");
  try {
    const shard = await store.shards.getWriteShard("project", tag.split("_").pop()!);
    const db = await store.connections.getConnection(shard.dbPath);
    const vector = await embeddingService.embedWithTimeout(text, { task: "document" });
    const now = Date.now();
    await tursoVectorSearch.insertVector(db, {
      id,
      content: text,
      vector,
      containerTag: tag,
      type: "memorisation",
      tags: "memorisation",
      createdAt: now + 60_000,
      updatedAt: now + 60_000,
    });
    await store.shards.incrementVectorCount(shard.id);
  } finally {
    await store.close();
  }
  // An earlier read may have cached Beta as empty; drop it so the next read sees the new row.
  const { closeAllCachedSpaceReadStores } =
    await import("../src/services/spaces/read-store-cache.js");
  await closeAllCachedSpaceReadStores();
}

beforeAll(async () => {
  useRegistry(["beta"]);
  const { initConfig } = await import("../src/config.js");
  initConfig(process.cwd());
  const { embeddingService } = await import("../src/services/embedding.js");
  await embeddingService.warmup();
}, 120_000);

afterAll(async () => {
  const { closeAllCachedSpaceReadStores } =
    await import("../src/services/spaces/read-store-cache.js");
  await closeAllCachedSpaceReadStores();
  rmSync(join(OMMS, "spaces.json"), { force: true });
  rmSync(SPACES_ROOT, { recursive: true, force: true });
  rmSync(join(OMMS, "backups"), { recursive: true, force: true });
});

afterEach(async () => {
  const { cleanupTursoTestDirectory } = await import("./turso-test-utils.js");
  await cleanupTursoTestDirectory();
  useRegistry(["beta"]);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/memorisations", () => {
  it("ignores paths and methods it does not own", async () => {
    const project = await freshProject();
    const { routeMemorisations } = await import("../src/services/memorisation-routes.js");
    const url = new URL("http://localhost/api/memories");
    const config = await routeConfig();
    expect(
      await routeMemorisations(url.pathname, "GET", url, project.directory, config)
    ).toBeUndefined();
    const own = new URL("http://localhost/api/memorisations");
    expect(
      await routeMemorisations(own.pathname, "POST", own, project.directory, config)
    ).toBeUndefined();
  }, 60_000);

  it("lists only memorisations, newest first, with ID, text, host and time", async () => {
    const project = await freshProject();
    const first = await operation(
      { mode: "memorise", content: "first note about the port" },
      project
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await operation(
      { mode: "memorise", topic: "release", next: "tag it" },
      project,
      "session-1"
    );
    // An ordinary memory of the same project must stay out of the list.
    await operation({ mode: "add", content: "an ordinary memory about the port" }, project);

    const result = await get(project, "/api/memorisations");
    expect(result!.status).toBe(200);
    const rows = result!.body.data.memorisations;
    expect(rows.map((row: any) => row.id)).toEqual([second.id, first.id]);
    expect(rows[0]).toMatchObject({
      id: second.id,
      content: "Topic: release\nNext: tag it",
      host: "pi",
      kind: "snapshot",
    });
    expect(rows[1]).toMatchObject({ id: first.id, content: "first note about the port" });
    expect(new Date(rows[0].createdAt).getTime()).toBeGreaterThan(
      new Date(rows[1].createdAt).getTime()
    );
    expect(rows.every((row: any) => row.id.startsWith("ms-"))).toBe(true);
  }, 60_000);

  it("includes linked spaces, names the space and sorts them with the rest", async () => {
    const project = await freshProject();
    const own = await operation({ mode: "memorise", content: "own space note" }, project);
    await writeLinkedMemorisation("ms-beta01", "linked space note", project.tags.project.tag);

    const rows = (await get(project, "/api/memorisations"))!.body.data.memorisations;
    expect(rows.map((row: any) => row.id)).toEqual(["ms-beta01", own.id]);
    expect(rows[0].space).toBe("Beta");
    expect(rows[1].space).toBeUndefined();
  }, 60_000);

  it("returns an empty list for a project with none", async () => {
    const project = await freshProject();
    await operation({ mode: "add", content: "only an ordinary memory here" }, project);
    const result = await get(project, "/api/memorisations");
    expect(result!.status).toBe(200);
    expect(result!.body.data.memorisations).toEqual([]);
  }, 60_000);

  it("drops a memorisation after the existing memory delete route removes it", async () => {
    const project = await freshProject();
    const saved = await operation({ mode: "memorise", content: "to be deleted" }, project);
    const { handleDeleteMemory } = await import("../src/services/api-handlers.js");
    expect((await handleDeleteMemory(saved.id)).success).toBe(true);
    const rows = (await get(project, "/api/memorisations"))!.body.data.memorisations;
    expect(rows).toEqual([]);
  }, 60_000);

  it("is served through the shared route modules", async () => {
    const project = await freshProject();
    const saved = await operation({ mode: "memorise", content: "routed note" }, project);
    const { routeModules } = await import("../src/services/web-route-modules.js");
    const url = new URL("http://localhost/api/memorisations");
    const routed = await routeModules(url.pathname, "GET", url, new Request(url), {
      cwd: project.directory,
      startRecordPast: async () => ({}) as never,
    });
    expect(routed!.status).toBe(200);
    expect((routed!.body as any).data.memorisations[0].id).toBe(saved.id);
  }, 60_000);
});

describe("GET /api/memorisations/recall", () => {
  it("returns the exact record for an ID", async () => {
    const project = await freshProject();
    const saved = await operation(
      { mode: "memorise", content: "use port 4747 for scratch" },
      project
    );
    const result = await get(project, `/api/memorisations/recall?q=${saved.id}`);
    expect(result!.status).toBe(200);
    expect(result!.body.data.count).toBe(1);
    expect(result!.body.data.matches[0]).toMatchObject({
      id: saved.id,
      content: "use port 4747 for scratch",
    });
  }, 60_000);

  it("answers 404 with the ID for an unknown ID", async () => {
    const project = await freshProject();
    const result = await get(project, "/api/memorisations/recall?q=ms-nope00");
    expect(result!.status).toBe(404);
    expect(result!.body.success).toBe(false);
    expect(result!.body.error).toContain("ms-nope00");
  }, 60_000);

  it("searches memorisations only by text and scores each match", async () => {
    const project = await freshProject();
    const saved = await operation(
      { mode: "memorise", content: "zebra crossing plan for the quarterly offsite" },
      project
    );
    await operation(
      { mode: "add", content: "zebra crossing plan for the quarterly offsite (ordinary)" },
      project
    );
    const { CONFIG } = await import("../src/config.js");
    const previous = CONFIG.similarityThreshold;
    CONFIG.similarityThreshold = 0.2;
    try {
      const result = await get(
        project,
        "/api/memorisations/recall?q=zebra%20crossing%20plan%20quarterly%20offsite"
      );
      expect(result!.status).toBe(200);
      const matches = result!.body.data.matches;
      expect(matches.map((match: any) => match.id)).toEqual([saved.id]);
      expect(matches[0].confidence).toBeGreaterThan(50);
    } finally {
      CONFIG.similarityThreshold = previous;
    }
  }, 60_000);

  it("asks for a query when q is missing or blank", async () => {
    const project = await freshProject();
    for (const path of ["/api/memorisations/recall", "/api/memorisations/recall?q=%20%20"]) {
      const result = await get(project, path);
      expect(result!.status).toBe(400);
      expect(result!.body.success).toBe(false);
    }
  }, 60_000);
});

describe("labels on the list", () => {
  it("gives each row its labels without the fixed memorisation tag, in stored order", async () => {
    const project = await freshProject();
    const labelled = await operation(
      { mode: "memorise", content: "labelled note", tags: "Auth, WIP" },
      project
    );
    const plain = await operation({ mode: "memorise", content: "plain note" }, project);
    const rows = (await get(project, "/api/memorisations"))!.body.data.memorisations;
    const byId = Object.fromEntries(rows.map((row: any) => [row.id, row]));
    expect(byId[labelled.id].tags).toEqual(["auth", "wip"]);
    expect(byId[plain.id].tags).toEqual([]);
  }, 60_000);

  it("keeps the labels of a linked-space row", async () => {
    const project = await freshProject();
    await writeLinkedMemorisation("ms-beta02", "linked labelled note", project.tags.project.tag);
    const rows = (await get(project, "/api/memorisations"))!.body.data.memorisations;
    expect(rows[0]).toMatchObject({ id: "ms-beta02", space: "Beta", tags: [] });
  }, 60_000);
});

describe("GET /api/memorisations?tags=", () => {
  async function three() {
    const project = await freshProject();
    const both = await operation(
      { mode: "memorise", content: "note with both", tags: "auth,wip" },
      project
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    const authOnly = await operation(
      { mode: "memorise", content: "note with auth", tags: "auth" },
      project
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    const none = await operation({ mode: "memorise", content: "note with no label" }, project);
    return { project, both, authOnly, none };
  }
  const idsOf = (result: any) => result!.body.data.memorisations.map((row: any) => row.id);

  it("returns only rows that carry every listed tag, newest first", async () => {
    const { project, both, authOnly } = await three();
    expect(idsOf(await get(project, "/api/memorisations?tags=auth"))).toEqual([
      authOnly.id,
      both.id,
    ]);
    expect(idsOf(await get(project, "/api/memorisations?tags=auth,wip"))).toEqual([both.id]);
    expect(idsOf(await get(project, "/api/memorisations?tags=auth,release"))).toEqual([]);
  }, 60_000);

  it("ignores case and surrounding spaces in the query", async () => {
    const { project, both } = await three();
    expect(idsOf(await get(project, "/api/memorisations?tags=%20AUTH%20,%20Wip"))).toEqual([
      both.id,
    ]);
  }, 60_000);

  it("does not match the fixed memorisation tag as a label request that narrows nothing", async () => {
    const { project } = await three();
    expect(idsOf(await get(project, "/api/memorisations?tags=memorisation"))).toHaveLength(3);
  }, 60_000);

  it("treats an empty tags value as no filter", async () => {
    const { project } = await three();
    expect(idsOf(await get(project, "/api/memorisations?tags="))).toHaveLength(3);
    expect(idsOf(await get(project, "/api/memorisations?tags=%20,%20"))).toHaveLength(3);
  }, 60_000);

  it("filters linked-space rows the same way", async () => {
    const project = await freshProject();
    await writeLinkedMemorisation("ms-beta03", "linked note", project.tags.project.tag);
    const own = await operation({ mode: "memorise", content: "own note", tags: "ops" }, project);
    // The linked helper stores only the fixed tag, so a label filter leaves just the own row.
    expect(idsOf(await get(project, "/api/memorisations?tags=ops"))).toEqual([own.id]);
    expect(idsOf(await get(project, "/api/memorisations?tags=nope"))).toEqual([]);
  }, 60_000);

  it("applies the 200-row cap after the filter, so an old labelled row is still found", async () => {
    const project = await freshProject();
    const base = Date.now();
    await seedRows(project, [
      {
        id: "ms-old001",
        content: "old labelled",
        type: "memorisation",
        tags: "memorisation,rare",
        createdAt: base - 10_000,
      },
      ...Array.from({ length: 205 }, (_, index) => ({
        id: `ms-new${String(index).padStart(3, "0")}`,
        content: `newer note ${index}`,
        type: "memorisation",
        tags: "memorisation",
        createdAt: base + index,
      })),
    ]);
    expect(idsOf(await get(project, "/api/memorisations?tags=rare"))).toEqual(["ms-old001"]);
    expect(idsOf(await get(project, "/api/memorisations"))).toHaveLength(200);
  }, 120_000);
});

describe("GET /api/memorisations/recall with tags", () => {
  it("adds the labels to an exact-ID match, without the fixed tag", async () => {
    const project = await freshProject();
    const saved = await operation(
      { mode: "memorise", content: "id match note", tags: "Auth" },
      project
    );
    const result = await get(project, `/api/memorisations/recall?q=${saved.id}`);
    expect(result!.body.data.matches[0].tags).toEqual(["auth"]);
  }, 60_000);

  it("returns the newest labelled memorisations when q is empty, with no confidence", async () => {
    const project = await freshProject();
    const first = await operation({ mode: "memorise", content: "older", tags: "auth" }, project);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await operation(
      { mode: "memorise", content: "newer", tags: "auth,wip" },
      project
    );
    await operation({ mode: "memorise", content: "other", tags: "release" }, project);
    for (const path of [
      "/api/memorisations/recall?tags=auth",
      "/api/memorisations/recall?q=&tags=AUTH",
      "/api/memorisations/recall?q=%20&tags=%20auth%20",
    ]) {
      const result = await get(project, path);
      expect(result!.status).toBe(200);
      const matches = result!.body.data.matches;
      expect(matches.map((match: any) => match.id)).toEqual([second.id, first.id]);
      expect(matches[0]).toMatchObject({ content: "newer", tags: ["auth", "wip"] });
      expect(matches.every((match: any) => !("confidence" in match))).toBe(true);
      expect(result!.body.data.count).toBe(2);
    }
  }, 60_000);

  it("keeps the 400 for an empty q when no tags are given", async () => {
    const project = await freshProject();
    for (const path of ["/api/memorisations/recall?tags=", "/api/memorisations/recall?tags=%20,"]) {
      expect((await get(project, path))!.status).toBe(400);
    }
  }, 60_000);

  it("names both q and tags when neither is given", async () => {
    const project = await freshProject();
    const result = await get(project, "/api/memorisations/recall");
    expect(result!.status).toBe(400);
    expect(result!.body.success).toBe(false);
    expect(result!.body.error).toContain("q");
    expect(result!.body.error).toContain("tags");
  }, 60_000);

  it("returns the record for an ID even when the labels do not match its own", async () => {
    const project = await freshProject();
    const saved = await operation(
      { mode: "memorise", content: "exact id wins", tags: "auth" },
      project
    );
    const result = await get(project, `/api/memorisations/recall?q=${saved.id}&tags=release,wip`);
    expect(result!.status).toBe(200);
    expect(result!.body.data.count).toBe(1);
    expect(result!.body.data.matches[0]).toMatchObject({ id: saved.id, content: "exact id wins" });
  }, 60_000);

  it("returns at most 10 labelled memorisations when no limit is given", async () => {
    const project = await freshProject();
    const base = Date.now() - 60_000;
    await seedRows(
      project,
      Array.from({ length: 12 }, (_, index) => ({
        id: `ms-seed${String(index).padStart(2, "0")}`,
        content: `labelled note ${index}`,
        type: "memorisation",
        tags: "memorisation,auth",
        createdAt: base + index * 1000,
      }))
    );
    const result = await get(project, "/api/memorisations/recall?tags=auth");
    expect(result!.status).toBe(200);
    const ids = result!.body.data.matches.map((match: any) => match.id);
    expect(ids).toHaveLength(10);
    expect(ids[0]).toBe("ms-seed11");
    expect(ids[9]).toBe("ms-seed02");
  }, 60_000);

  it("answers an empty list, not an error, when no memorisation has the labels", async () => {
    const project = await freshProject();
    await operation({ mode: "memorise", content: "unlabelled" }, project);
    const result = await get(project, "/api/memorisations/recall?tags=ghost");
    expect(result!.status).toBe(200);
    expect(result!.body.data).toMatchObject({ count: 0, matches: [] });
  }, 60_000);

  it("honours limit for a label-only recall", async () => {
    const project = await freshProject();
    for (const text of ["one", "two", "three"]) {
      await operation({ mode: "memorise", content: text, tags: "auth" }, project);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    const result = await get(project, "/api/memorisations/recall?tags=auth&limit=2");
    expect(result!.body.data.matches.map((match: any) => match.content)).toEqual(["three", "two"]);
  }, 60_000);

  it("restricts a text search to memorisations with the labels and scores each match", async () => {
    const project = await freshProject();
    const labelled = await operation(
      { mode: "memorise", content: "zebra crossing plan for the offsite", tags: "events" },
      project
    );
    await operation(
      { mode: "memorise", content: "zebra crossing plan for the offsite budget" },
      project
    );
    const { CONFIG } = await import("../src/config.js");
    const previous = CONFIG.similarityThreshold;
    CONFIG.similarityThreshold = 0.2;
    try {
      const unfiltered = await get(
        project,
        "/api/memorisations/recall?q=zebra%20crossing%20plan%20offsite"
      );
      expect(unfiltered!.body.data.matches.length).toBeGreaterThan(1);
      const result = await get(
        project,
        "/api/memorisations/recall?q=zebra%20crossing%20plan%20offsite&tags=Events"
      );
      const matches = result!.body.data.matches;
      expect(matches.map((match: any) => match.id)).toEqual([labelled.id]);
      expect(matches[0].confidence).toBeGreaterThan(50);
      expect(matches[0].tags).toEqual(["events"]);
    } finally {
      CONFIG.similarityThreshold = previous;
    }
  }, 60_000);

  it("finds a labelled match that ranks below the usual result limit", async () => {
    const project = await freshProject();
    for (let index = 0; index < 12; index++) {
      await operation({ mode: "memorise", content: `zebra crossing plan copy ${index}` }, project);
    }
    const tagged = await operation(
      { mode: "memorise", content: "zebra crossing plan for the quarterly offsite", tags: "rare" },
      project
    );
    const { CONFIG } = await import("../src/config.js");
    const previous = CONFIG.similarityThreshold;
    CONFIG.similarityThreshold = 0.2;
    try {
      const result = await get(
        project,
        "/api/memorisations/recall?q=zebra%20crossing%20plan%20copy&tags=rare"
      );
      expect(result!.body.data.matches.map((match: any) => match.id)).toEqual([tagged.id]);
    } finally {
      CONFIG.similarityThreshold = previous;
    }
  }, 120_000);
});

describe("POST /api/memorisations/bulk-delete", () => {
  const listed = async (project: any) =>
    (await get(project, "/api/memorisations"))!.body.data.memorisations.map((row: any) => row.id);

  it("deletes the listed memorisations and leaves the others", async () => {
    const project = await freshProject();
    const a = await operation({ mode: "memorise", content: "delete me one" }, project);
    const b = await operation({ mode: "memorise", content: "delete me two" }, project);
    const keep = await operation({ mode: "memorise", content: "keep me" }, project);
    const result = await post(project, "/api/memorisations/bulk-delete", { ids: [a.id, b.id] });
    expect(result!.status).toBe(200);
    expect(result!.body.success).toBe(true);
    expect(result!.body.data).toEqual({ deleted: [a.id, b.id], skipped: [] });
    expect(await listed(project)).toEqual([keep.id]);
  }, 60_000);

  it("skips an unknown ID as not-found and still deletes the rest", async () => {
    const project = await freshProject();
    const a = await operation({ mode: "memorise", content: "delete me" }, project);
    const result = await post(project, "/api/memorisations/bulk-delete", {
      ids: ["ms-nope00", a.id],
    });
    expect(result!.body.data).toEqual({
      deleted: [a.id],
      skipped: [{ id: "ms-nope00", reason: "not-found" }],
    });
  }, 60_000);

  it("skips a linked-space row as linked and does not touch the linked space", async () => {
    const project = await freshProject();
    await writeLinkedMemorisation("ms-beta04", "linked note", project.tags.project.tag);
    const result = await post(project, "/api/memorisations/bulk-delete", { ids: ["ms-beta04"] });
    expect(result!.body.data).toEqual({
      deleted: [],
      skipped: [{ id: "ms-beta04", reason: "linked" }],
    });
    expect(await listed(project)).toEqual(["ms-beta04"]);
  }, 60_000);

  it("skips a row that is not a memorisation and keeps it", async () => {
    const project = await freshProject();
    await seedRows(project, [
      {
        id: "ms-plain1",
        content: "an ordinary decision",
        type: "decision",
        tags: "x",
        createdAt: Date.now(),
      },
    ]);
    const result = await post(project, "/api/memorisations/bulk-delete", { ids: ["ms-plain1"] });
    expect(result!.body.data).toEqual({
      deleted: [],
      skipped: [{ id: "ms-plain1", reason: "not-memorisation" }],
    });
    const { memoryClient } = await import("../src/services/client.js");
    const kept = await memoryClient.listMemories(project.tags.project.tag, 10, "project");
    expect(kept.memories.map((memory: any) => memory.id)).toEqual(["ms-plain1"]);
  }, 60_000);

  it("leaves another project's memorisation alone and reports it as not-found", async () => {
    const mine = await freshProject();
    const other = await freshProject();
    const theirs = await operation({ mode: "memorise", content: "other project note" }, other);
    const result = await post(mine, "/api/memorisations/bulk-delete", { ids: [theirs.id] });
    expect(result!.body.data).toEqual({
      deleted: [],
      skipped: [{ id: theirs.id, reason: "not-found" }],
    });
    expect(await listed(other)).toEqual([theirs.id]);
  }, 60_000);

  it("deletes a repeated ID once", async () => {
    const project = await freshProject();
    const a = await operation({ mode: "memorise", content: "once" }, project);
    const result = await post(project, "/api/memorisations/bulk-delete", { ids: [a.id, a.id] });
    expect(result!.body.data).toEqual({ deleted: [a.id], skipped: [] });
  }, 60_000);

  it("refuses a body that is not 1 to 500 ms- IDs, and deletes nothing", async () => {
    const project = await freshProject();
    const a = await operation({ mode: "memorise", content: "survivor" }, project);
    const tooMany = Array.from(
      { length: 501 },
      (_, index) => `ms-${String(index).padStart(6, "0")}`
    );
    const bad: unknown[] = [
      undefined,
      {},
      { ids: "ms-abc123" },
      { ids: [] },
      { ids: tooMany },
      { ids: [a.id, "mem_123_abc"] },
      { ids: [a.id, "ms-ABC123"] },
      { ids: [a.id, 42] },
    ];
    for (const body of bad) {
      const result = await post(project, "/api/memorisations/bulk-delete", body);
      expect(result!.status).toBe(400);
      expect(result!.body.success).toBe(false);
    }
    expect(await listed(project)).toEqual([a.id]);
    const max = await post(project, "/api/memorisations/bulk-delete", {
      ids: tooMany.slice(0, 500),
    });
    expect(max!.status).toBe(200);
    expect(max!.body.data.skipped).toHaveLength(500);
  }, 120_000);

  it("is a POST route only", async () => {
    const project = await freshProject();
    expect(await get(project, "/api/memorisations/bulk-delete")).toBeUndefined();
  }, 60_000);

  it("leaves the general bulk delete refusing memorisations", async () => {
    const project = await freshProject();
    const a = await operation({ mode: "memorise", content: "still refused there" }, project);
    const { handleBulkDelete } = await import("../src/services/api-handlers.js");
    expect((await handleBulkDelete([a.id])).success).toBe(false);
    expect(await listed(project)).toEqual([a.id]);
  }, 60_000);

  it("is served through the shared route modules and the token check", async () => {
    const project = await freshProject();
    const a = await operation({ mode: "memorise", content: "routed delete" }, project);
    const { WebServer } = await import("../src/services/web-server.js");
    const { getOrCreateAuthToken } = await import("../src/services/auth-token.js");
    const server = new WebServer({
      enabled: true,
      host: "127.0.0.1",
      port: 4747,
      directory: project.directory,
    });
    const handle = server as unknown as {
      handleRequest(request: Request, address: string): Promise<Response>;
    };
    const request = (headers: Record<string, string>) =>
      new Request("http://127.0.0.1:4747/api/memorisations/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ ids: [a.id] }),
      });
    const refused = await handle.handleRequest(request({}), "127.0.0.1");
    expect(refused.status).toBe(401);
    expect(await listed(project)).toEqual([a.id]);
    const allowed = await handle.handleRequest(
      request({ "x-omms-token": getOrCreateAuthToken() }),
      "127.0.0.1"
    );
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).data).toEqual({ deleted: [a.id], skipped: [] });
    expect(await listed(project)).toEqual([]);
  }, 60_000);
});
