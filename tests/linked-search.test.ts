import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

/**
 * Linked-space search (openspec change memory-space-transfer, task 5): a space
 * reads the memories of the spaces it links, read-only, own results first.
 *
 * The registry is written before the first import of `src/config.js`, so the
 * active space "alpha" resolves once and stays for the whole file. Every test
 * uses its own project tag, so spaces accumulate rows without cross-talk.
 */

const OMMS = join(homedir(), ".omms");
const SPACES_ROOT = join(OMMS, "spaces");
const ALPHA = join(SPACES_ROOT, "alpha");
const BETA = join(SPACES_ROOT, "beta");
const GAMMA = join(SPACES_ROOT, "gamma");
const THETA = join(SPACES_ROOT, "theta");
const IOTA = join(SPACES_ROOT, "iota");

const SPACES = [
  { id: "beta", name: "Beta" },
  { id: "gamma", name: "Gamma" },
  { id: "delta", name: "Delta" }, // registered but its folder is never created
  { id: "eps", name: "Eps" },
  { id: "zeta", name: "Zeta" },
  { id: "eta", name: "Eta" },
  { id: "theta", name: "Theta" },
  { id: "iota", name: "Iota" },
];

/** Rewrites spaces.json: alpha active, alpha and beta with the given links. */
function useRegistry(alphaLinks: string[], betaLinks: string[] = []): void {
  const entry = (id: string, name: string, links?: string[]) => ({
    id,
    name,
    createdAt: "2026-11-06T09:00:00.000Z",
    archived: false,
    ...(links && links.length > 0 ? { links } : {}),
  });
  mkdirSync(ALPHA, { recursive: true });
  for (const space of SPACES) {
    if (space.id !== "delta") mkdirSync(join(SPACES_ROOT, space.id), { recursive: true });
  }
  writeFileSync(
    join(OMMS, "spaces.json"),
    `${JSON.stringify(
      {
        version: 1,
        activeSpaceId: "alpha",
        spaces: [
          entry("alpha", "Alpha", alphaLinks),
          entry("beta", "Beta", betaLinks),
          ...SPACES.filter((s) => s.id !== "beta").map((s) => entry(s.id, s.name)),
        ],
      },
      null,
      2
    )}\n`
  );
}

/** SHA-256 of every file under `folder`, keyed by its path relative to the folder. */
function hashFolder(folder: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        const digest = createHash("sha256").update(readFileSync(full)).digest("hex");
        hashes.set(relative(folder, full), digest);
      }
    }
  };
  walk(folder);
  return hashes;
}

/** A distinct 16-hex scope hash per test, so every test reads only its own rows. */
let hashCounter = 0;
function freshTag(): string {
  // One 16-hex scope hash per test. Built as a string: a 2^60 offset plus a
  // counter is not exact in a double, so every test would get the same hash.
  const hash = `${hashCounter++}`.padStart(16, "0");
  return `omms_project_${hash}`;
}

interface WrittenMemory {
  id: string;
  text: string;
  tag: string;
  createdAt?: number;
  vector?: Float32Array;
}

/** Writes one memory straight into a space folder through a write store. */
async function writeMemory(folder: string, memory: WrittenMemory): Promise<void> {
  const { embeddingService } = await import("../src/services/embedding.js");
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const hash = memory.tag.split("_").pop()!;
  const store = openSpaceStore(folder, "write");
  try {
    const shard = await store.shards.getWriteShard("project", hash);
    const db = await store.connections.getConnection(shard.dbPath);
    const vector =
      memory.vector ?? (await embeddingService.embedWithTimeout(memory.text, { task: "document" }));
    const now = memory.createdAt ?? Date.now();
    await tursoVectorSearch.insertVector(db, {
      id: memory.id,
      content: memory.text,
      vector,
      containerTag: memory.tag,
      createdAt: now,
      updatedAt: now,
    });
    await store.shards.incrementVectorCount(shard.id);
  } finally {
    await store.close();
  }
}

/** Reads one memory id from a space folder, read-only. */
async function readMemoryId(folder: string, id: string): Promise<boolean> {
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const store = openSpaceStore(folder, "read");
  try {
    for (const shard of await store.listShards("project", "")) {
      const db = await store.openShard(shard.dbPath);
      const row = await db.get(`SELECT id FROM memories WHERE id = ?`, [id]);
      if (row) return true;
    }
    return false;
  } finally {
    await store.close();
  }
}

/** Mutates CONFIG for one test and restores the previous values afterwards. */
async function withConfig<T>(patch: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  const { CONFIG } = await import("../src/config.js");
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, (CONFIG as any)[key]]));
  Object.assign(CONFIG, patch);
  try {
    return await run();
  } finally {
    Object.assign(CONFIG, previous);
  }
}

async function searchLinked(query: string, tag: string, maxMemories = 10) {
  const { memoryClient } = await import("../src/services/client.js");
  return withConfig({ maxMemories, similarityThreshold: 0.25 }, () =>
    memoryClient.searchMemories(query, tag, "project", { includeLinked: true })
  );
}

/** Records every searchAcrossShards call, so a test can inspect the linked one. */
async function spySearchAcrossShards() {
  const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
  const original = tursoVectorSearch.searchAcrossShards.bind(tursoVectorSearch);
  const calls: any[][] = [];
  (tursoVectorSearch as any).searchAcrossShards = async (...args: any[]) => {
    calls.push(args);
    return original(...args);
  };
  return {
    calls,
    restore: () => {
      (tursoVectorSearch as any).searchAcrossShards = original;
    },
  };
}

beforeAll(async () => {
  useRegistry(["beta"]);
  // initConfig resolves the active space from the registry written above.
  const { initConfig } = await import("../src/config.js");
  initConfig(process.cwd());
  const { embeddingService } = await import("../src/services/embedding.js");
  await embeddingService.warmup();
});

// The run's test home is shared between files, and this file leaves the active
// space as "alpha". Later files (for example web-space-routes) read that state,
// so the registry, the space folders and the archive backups this file writes
// must not outlive it.
afterAll(() => {
  rmSync(join(OMMS, "spaces.json"), { force: true });
  rmSync(SPACES_ROOT, { recursive: true, force: true });
  rmSync(join(OMMS, "backups"), { recursive: true, force: true });
});

afterEach(async () => {
  const { cleanupTursoTestDirectory } = await import("./turso-test-utils.js");
  await cleanupTursoTestDirectory();
  useRegistry(["beta"]);
});

describe("linked search", () => {
  it("puts own results first and lets linked results fill only the free places", async () => {
    const tag = freshTag();
    useRegistry(["beta"]);
    const { memoryClient } = await import("../src/services/client.js");
    const query = "Deploy the payment worker with wrangler and check the route";
    for (let i = 1; i <= 4; i++) {
      const added = await memoryClient.addMemory(
        `Note ${i}: the deploy script ships the payment worker and prints the route it serves`,
        tag,
        { type: "workflow" }
      );
      expect(added.success).toBe(true);
    }
    await writeMemory(BETA, { id: "beta_fill_1", text: query, tag });
    await writeMemory(BETA, { id: "beta_fill_2", text: `${query} again`, tag });
    await writeMemory(BETA, { id: "beta_fill_3", text: `How to ${query}?`, tag });

    const result = await searchLinked(query, tag, 5);
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(5);
    // The four own memories keep their places; only the fifth goes to Beta.
    expect(result.results.slice(0, 4).every((r: any) => r.spaceName === undefined)).toBe(true);
    expect(result.results[4].spaceName).toBe("Beta");
  });

  it("returns linked results when the own space has no match", async () => {
    const tag = freshTag();
    useRegistry(["beta"]);
    await writeMemory(BETA, {
      id: "beta_only_1",
      text: "The cache key includes the shard id",
      tag,
    });
    await writeMemory(BETA, {
      id: "beta_only_2",
      text: "The cache key includes the shard id and scope",
      tag,
    });

    const result = await searchLinked("What does the cache key include?", tag);
    expect(result.success).toBe(true);
    expect(result.results.length).toBeGreaterThanOrEqual(2);
    expect(result.results.every((r: any) => r.spaceName === "Beta")).toBe(true);
  });

  it("sends the same query vector and threshold to the linked search", async () => {
    const tag = freshTag();
    useRegistry(["beta"]);
    const { memoryClient } = await import("../src/services/client.js");
    await memoryClient.addMemory("Release notes mention the retry queue", tag, { type: "fact" });
    await writeMemory(BETA, {
      id: "beta_vector",
      text: "The retry queue drains every minute",
      tag,
    });

    const { CONFIG } = await import("../src/config.js");
    let result: any;
    let thresholdUsed = -1;
    const spy = await spySearchAcrossShards();
    try {
      result = await withConfig({ maxMemories: 10, similarityThreshold: 0.25 }, () => {
        thresholdUsed = CONFIG.similarityThreshold;
        return memoryClient.searchMemories("retry queue drain", tag, "project", {
          includeLinked: true,
        });
      });
    } finally {
      spy.restore();
    }
    expect(result.success).toBe(true);
    // The 9-argument call is the linked one: it carries the read-only db opener.
    const linkedCall = spy.calls.find((call) => call.length === 9 && typeof call[8] === "function");
    expect(linkedCall).toBeDefined();
    expect(linkedCall![1]).toBe(result.queryVector);
    expect(linkedCall![4]).toBe(thresholdUsed);
  });

  it("appends linked rows after the own rows, newest first, up to the limit", async () => {
    const tag = freshTag();
    useRegistry(["beta"]);
    const { memoryClient } = await import("../src/services/client.js");
    await memoryClient.addMemory("Own row one about the ledger export", tag);
    await memoryClient.addMemory("Own row two about the ledger export", tag);
    const now = Date.now();
    await writeMemory(BETA, {
      id: "beta_list_old",
      text: "Beta older ledger row",
      tag,
      createdAt: now - 3000,
    });
    await writeMemory(BETA, {
      id: "beta_list_mid",
      text: "Beta middle ledger row",
      tag,
      createdAt: now - 2000,
    });
    await writeMemory(BETA, {
      id: "beta_list_new",
      text: "Beta newest ledger row",
      tag,
      createdAt: now - 1000,
    });

    const limited = await withConfig({}, () =>
      memoryClient.listMemories(tag, 3, "project", { includeLinked: true })
    );
    expect(limited.success).toBe(true);
    expect(limited.memories).toHaveLength(3);
    const ownIds = limited.memories.slice(0, 2).map((m: any) => m.id);
    expect(ownIds.every((id: string) => id.startsWith("mem_"))).toBe(true);
    expect(limited.memories.slice(0, 2).every((m: any) => m.spaceName === undefined)).toBe(true);
    expect(limited.memories[2]).toMatchObject({ id: "beta_list_new", spaceName: "Beta" });

    const full = await withConfig({}, () =>
      memoryClient.listMemories(tag, 10, "project", { includeLinked: true })
    );
    expect(full.memories).toHaveLength(5);
    expect(full.memories.slice(2).map((m: any) => m.id)).toEqual([
      "beta_list_new",
      "beta_list_mid",
      "beta_list_old",
    ]);
  });

  it("skips a missing or archived linked space with a warning that names it", async () => {
    const tag = freshTag();
    useRegistry(["beta", "delta"]);
    await writeMemory(BETA, {
      id: "beta_skip_missing",
      text: "Ledger rows carry a version column",
      tag,
    });

    const missing = await searchLinked("ledger version column", tag);
    expect(missing.success).toBe(true);
    expect(missing.warnings?.some((w: string) => w.includes("Delta"))).toBe(true);

    const { archiveStoredSpace } = await import("../src/services/spaces/registry-store.js");
    const { spaceFiles } = await import("../src/services/spaces/registry-store.js");
    await archiveStoredSpace(spaceFiles(OMMS), "beta");
    const archived = await searchLinked("ledger version column", tag);
    expect(archived.success).toBe(true);
    expect(archived.warnings?.some((w: string) => w.includes("Beta"))).toBe(true);
    expect(archived.results.every((r: any) => r.spaceName !== "Beta")).toBe(true);
  });

  it("skips a linked space with other embedding dimensions", async () => {
    const tag = freshTag();
    useRegistry(["beta", "eps"]);
    await writeMemory(BETA, {
      id: "beta_dims_ok",
      text: "The scheduler pins workers to queues",
      tag,
    });
    // Eps is written with 256-dimension vectors, unlike the current settings.
    await withConfig({ embeddingDimensions: 256 }, async () => {
      await writeMemory(EPS_FOLDER(), {
        id: "eps_dims_off",
        text: "The scheduler pins workers to queues",
        tag,
        vector: new Float32Array(256).fill(0.1),
      });
    });

    const result = await searchLinked("scheduler queues", tag);
    expect(result.success).toBe(true);
    expect(result.results.some((r: any) => r.spaceName === "Eps")).toBe(false);
    expect(
      result.warnings?.some(
        (w: string) => w.includes("Eps") && w.toLowerCase().includes("re-embed")
      )
    ).toBe(true);
    expect(result.results.some((r: any) => r.spaceName === "Beta")).toBe(true);
  });

  it("skips a linked space with another model and equal dimensions", async () => {
    const tag = freshTag();
    useRegistry(["beta", "zeta"]);
    await writeMemory(ZETA_FOLDER(), {
      id: "zeta_model_off",
      text: "Rate limits reset at midnight",
      tag,
    });
    await rewriteShardMetadata(ZETA_FOLDER(), "embedding_model", "other/embed-model");

    const result = await searchLinked("rate limits midnight", tag);
    expect(result.success).toBe(true);
    expect(result.results.some((r: any) => r.spaceName === "Zeta")).toBe(false);
    expect(
      result.warnings?.some(
        (w: string) => w.includes("Zeta") && w.toLowerCase().includes("re-embed")
      )
    ).toBe(true);
  });

  it("reads a linked space that records no model when the dimensions match", async () => {
    const tag = freshTag();
    useRegistry(["beta", "eta"]);
    await writeMemory(ETA_FOLDER(), {
      id: "eta_no_model",
      text: "The nightly job vacuums the shards",
      tag,
    });
    await deleteShardMetadataKey(ETA_FOLDER(), "embedding_model");

    const result = await searchLinked("nightly job vacuum shards", tag);
    expect(result.success).toBe(true);
    expect(result.results.some((r: any) => r.spaceName === "Eta")).toBe(true);
    expect((result.warnings ?? []).some((w: string) => w.includes("Eta"))).toBe(false);
  });

  it("does not follow links transitively", async () => {
    const tag = freshTag();
    useRegistry(["beta"], ["gamma"]);
    const query = "The migration renames the old tag prefix everywhere";
    await writeMemory(GAMMA, { id: "gamma_hidden", text: query, tag });

    const result = await searchLinked(query, tag);
    expect(result.success).toBe(true);
    expect(result.results.some((r: any) => r.spaceName === "Gamma")).toBe(false);
  });

  it("stops reading a space after it is unlinked, and keeps its data", async () => {
    const tag = freshTag();
    useRegistry(["beta"]);
    await writeMemory(BETA, { id: "beta_unlink", text: "The unlink row about manifests", tag });

    const before = await searchLinked("manifests", tag);
    expect(before.results.some((r: any) => r.spaceName === "Beta")).toBe(true);

    const { spaceFiles, unlinkStoredSpace } =
      await import("../src/services/spaces/registry-store.js");
    await unlinkStoredSpace(spaceFiles(OMMS), "alpha", "beta");

    const after = await searchLinked("manifests", tag);
    expect(after.success).toBe(true);
    expect(after.results.some((r: any) => r.spaceName === "Beta")).toBe(false);
    expect(await readMemoryId(BETA, "beta_unlink")).toBe(true);
  });

  it("reads linked spaces for an all-projects search", async () => {
    const tag = freshTag();
    const linkedTag = freshTag();
    useRegistry(["beta"]);
    await writeMemory(BETA, {
      id: "beta_all",
      text: "The all-projects linked row about quotas",
      tag: linkedTag,
    });

    const { memoryClient } = await import("../src/services/client.js");
    const result = await withConfig({ maxMemories: 10, similarityThreshold: 0.25 }, () =>
      memoryClient.searchMemories("quotas", tag, "all-projects", { includeLinked: true })
    );
    expect(result.success).toBe(true);
    expect(result.results.some((r: any) => r.spaceName === "Beta")).toBe(true);
  });

  it("leaves the linked folder byte-identical after a search and a list", async () => {
    const tag = freshTag();
    useRegistry(["beta"]);
    await writeMemory(BETA, { id: "beta_bytes", text: "Backups land in the backups folder", tag });
    const before = hashFolder(BETA);
    expect(before.size).toBeGreaterThan(0);

    await searchLinked("backups folder", tag);
    const { memoryClient } = await import("../src/services/client.js");
    await withConfig({}, () =>
      memoryClient.listMemories(tag, 5, "project", { includeLinked: true })
    );

    expect(hashFolder(BETA)).toEqual(before);
  });
});

describe("forget refuses a linked memory", () => {
  it("names the space and changes nothing", async () => {
    const tag = freshTag();
    useRegistry(["beta"]);
    await writeMemory(BETA, { id: "beta_keep_me", text: "Keep this row in the linked space", tag });
    const before = hashFolder(BETA);

    const { memoryClient } = await import("../src/services/client.js");
    const result = await withConfig({}, () => memoryClient.deleteMemory("beta_keep_me"));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Beta");
    expect(await readMemoryId(BETA, "beta_keep_me")).toBe(true);
    expect(hashFolder(BETA)).toEqual(before);
  });
});

describe("deleting a linked space", () => {
  it("closes the cached read store before the folder is removed", async () => {
    const tag = freshTag();
    useRegistry(["beta", "theta"]);
    await writeMemory(THETA, { id: "theta_gone", text: "Theta holds one row about ports", tag });

    // A warm cached read store, as a search in an earlier turn left behind.
    const { getCachedSpaceReadStore, closeCachedSpaceReadStore } =
      await import("../src/services/spaces/read-store-cache.js");
    const store = getCachedSpaceReadStore(THETA);
    const shards = await store.listShards("project", tag.split("_").pop()!);
    await store.openShard(shards[0]!.dbPath);

    let closedFolder: string | null = null;
    const { deleteSpace } = await import("../src/services/spaces/delete.js");
    const { spaceFiles } = await import("../src/services/spaces/registry-store.js");
    const result = await deleteSpace(
      spaceFiles(OMMS),
      "theta",
      { ommsVersion: "test" },
      {
        closeReadStore: async (folder) => {
          closedFolder = folder;
          await closeCachedSpaceReadStore(folder);
        },
      }
    );

    expect(closedFolder).toBe(THETA);
    expect(result.space.id).toBe("theta");
    expect(existsSync(THETA)).toBe(false);
  });

  it("shows the link as unavailable and later searches skip it with a warning", async () => {
    const tag = freshTag();
    useRegistry(["beta", "iota"]);
    await writeMemory(IOTA, { id: "iota_row", text: "Iota row about the export dialog", tag });

    const { deleteSpace } = await import("../src/services/spaces/delete.js");
    const { spaceFiles } = await import("../src/services/spaces/registry-store.js");
    await deleteSpace(spaceFiles(OMMS), "iota", { ommsVersion: "test" });

    const { readRegistryFile, spaceLinks } = await import("../src/services/spaces/registry.js");
    const { registry } = readRegistryFile(join(OMMS, "spaces.json"));
    const iota = spaceLinks(registry, "alpha").find((link) => link.id === "iota");
    expect(iota).toMatchObject({ available: false });

    const result = await searchLinked("export dialog", tag);
    expect(result.success).toBe(true);
    expect(result.warnings?.some((w: string) => w.includes("iota"))).toBe(true);
    expect(result.results.some((r: any) => r.spaceName === "Iota")).toBe(false);
  });
});

function EPS_FOLDER() {
  return join(SPACES_ROOT, "eps");
}
function ZETA_FOLDER() {
  return join(SPACES_ROOT, "zeta");
}
function ETA_FOLDER() {
  return join(SPACES_ROOT, "eta");
}

/** Rewrites one shard_metadata key in every shard of a space folder. */
async function rewriteShardMetadata(folder: string, key: string, value: string): Promise<void> {
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const store = openSpaceStore(folder, "write");
  try {
    for (const shard of await store.shards.getAllShards("project", "")) {
      const db = await store.connections.getConnection(shard.dbPath);
      await db.run(`UPDATE shard_metadata SET value = ? WHERE key = ?`, [value, key]);
    }
  } finally {
    await store.close();
  }
}

/** Removes one shard_metadata key in every shard of a space folder. */
async function deleteShardMetadataKey(folder: string, key: string): Promise<void> {
  const { openSpaceStore } = await import("../src/services/spaces/space-store.js");
  const store = openSpaceStore(folder, "write");
  try {
    for (const shard of await store.shards.getAllShards("project", "")) {
      const db = await store.connections.getConnection(shard.dbPath);
      await db.run(`DELETE FROM shard_metadata WHERE key = ?`, [key]);
    }
  } finally {
    await store.close();
  }
}
