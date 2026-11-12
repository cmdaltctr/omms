import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Memorise and recall against the real store, with real embeddings: the ID
 * lookup across the active and linked spaces, the session lookup behind
 * `memorisationRepeat: "replace"`, and the full tool path.
 */

const OMMS = join(homedir(), ".omms");
const SPACES_ROOT = join(OMMS, "spaces");
const ALPHA = join(SPACES_ROOT, "alpha");
const BETA = join(SPACES_ROOT, "beta");

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

let counter = 0;
/** A scope hash per test, so every test reads only its own rows. */
function freshTag(): string {
  return `omms_project_${`${counter++}`.padStart(16, "0")}`;
}

function toolTags(tag: string) {
  return {
    project: { tag, displayName: "Store Test", userName: "t", userEmail: "t@example.com" },
    user: { tag: "omms_user_0000000000000000", userName: "t", userEmail: "t@example.com" },
  } as any;
}

async function memorise(args: Record<string, unknown>, tag: string, hostSessionId?: string) {
  const { executeMemoryOperation } = await import("../src/core/memory-operations.js");
  return executeMemoryOperation({ mode: "memorise", ...args } as any, {
    directory: process.cwd(),
    host: "pi",
    hostSessionId,
    tags: toolTags(tag),
  });
}

async function operation(args: Record<string, unknown>, tag: string) {
  const { executeMemoryOperation } = await import("../src/core/memory-operations.js");
  return executeMemoryOperation(args as any, { directory: process.cwd(), tags: toolTags(tag) });
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
      createdAt: now,
      updatedAt: now,
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

async function withConfig<T>(patch: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  // The tool reloads a changed config on entry, so reload first or it drops the patch.
  const configModule = await import("../src/config.js");
  configModule.refreshConfigIfChanged(process.cwd());
  const CONFIG = configModule.CONFIG; // read after the reload, which may replace the object
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, (CONFIG as any)[key]]));
  Object.assign(CONFIG, patch);
  try {
    return await run();
  } finally {
    Object.assign(CONFIG, previous);
  }
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
});

describe("memorise and recall through the real store", () => {
  it("saves under an ms- ID and recalls the exact text by that ID", async () => {
    const tag = freshTag();
    const saved = await memorise({ content: "use port 4747 for the scratch web app" }, tag);
    expect(saved.success).toBe(true);
    expect(saved.id).toMatch(/^ms-[a-z0-9]{6}$/);

    const recalled: any = await operation({ mode: "recall", query: saved.id }, tag);
    expect(recalled.success).toBe(true);
    expect(recalled.matches).toHaveLength(1);
    expect(recalled.matches[0].content).toBe("use port 4747 for the scratch web app");
    expect(recalled.matches[0].id).toBe(saved.id);
  }, 60_000);

  it("keeps memorisations out of search and list", async () => {
    const tag = freshTag();
    await memorise({ content: "zebra crossing plan for the quarterly offsite" }, tag);
    const search: any = await operation(
      { mode: "search", query: "zebra crossing plan quarterly offsite" },
      tag
    );
    expect(search.results).toHaveLength(0);
    const list: any = await operation({ mode: "list" }, tag);
    expect(list.memories ?? []).toHaveLength(0);
  }, 60_000);

  it("recalls a memorisation by text with a confidence score", async () => {
    const tag = freshTag();
    const saved = await memorise({ content: "penguin crossing plan for the autumn offsite" }, tag);
    const recalled: any = await withConfig({ similarityThreshold: 0.2 }, () =>
      operation({ mode: "recall", query: "penguin crossing plan autumn offsite" }, tag)
    );
    expect(recalled.success).toBe(true);
    expect(recalled.matches[0].id).toBe(saved.id);
    expect(recalled.matches[0].confidence).toBeGreaterThan(50);
  }, 60_000);

  it("recalls an ID that lives in a linked space and names the space", async () => {
    const tag = freshTag();
    await writeLinkedMemorisation("ms-beta01", "ship the beta handover notes", tag);
    const recalled: any = await operation({ mode: "recall", query: "ms-beta01" }, tag);
    expect(recalled.success).toBe(true);
    expect(recalled.matches[0]).toMatchObject({
      id: "ms-beta01",
      content: "ship the beta handover notes",
      space: "Beta",
    });
  }, 60_000);

  it("recalls another project's memorisation by its ID in the same space", async () => {
    const tagA = freshTag();
    const tagB = freshTag();
    const saved = await memorise({ content: "project A deploy key rotation notes" }, tagA);
    expect(saved.success).toBe(true);

    const fromB: any = await operation({ mode: "recall", query: saved.id }, tagB);
    expect(fromB.success).toBe(true);
    expect(fromB.matches[0]).toMatchObject({
      id: saved.id,
      content: "project A deploy key rotation notes",
    });

    const fromA: any = await operation({ mode: "recall", query: saved.id }, tagA);
    expect(fromA.success).toBe(true);
  }, 60_000);

  it("recalls another project's linked memorisation by its ID and names the space", async () => {
    const tagA = freshTag();
    const tagB = freshTag();
    await writeLinkedMemorisation("ms-beta02", "linked notes of project A", tagA);

    const fromB: any = await operation({ mode: "recall", query: "ms-beta02" }, tagB);
    expect(fromB.success).toBe(true);
    expect(fromB.matches[0].space).toBe("Beta");

    const fromA: any = await operation({ mode: "recall", query: "ms-beta02" }, tagA);
    expect(fromA.success).toBe(true);
    expect(fromA.matches[0].space).toBe("Beta");
  }, 60_000);

  it("finds a row of another project when the project argument is null", async () => {
    const tagA = freshTag();
    const tagB = freshTag();
    const saved = await memorise({ content: "cross-project note for the null lookup" }, tagA);
    expect(saved.success).toBe(true);
    const { getMemorisationById } = await import("../src/services/memorisation-store.js");
    const { CONFIG } = await import("../src/config.js");
    const { linkedSettingsFrom } = await import("../src/services/linked-search.js");
    const linked = linkedSettingsFrom(CONFIG);

    const found = await getMemorisationById(saved.id as string, null, linked);
    expect(found).toMatchObject({
      id: saved.id,
      content: "cross-project note for the null lookup",
    });

    // The string form still narrows to one project, so tagB sees nothing.
    expect(await getMemorisationById(saved.id as string, tagB, linked)).toBeNull();
  }, 60_000);

  it("deletes a row of another project when the project argument is null", async () => {
    const tagA = freshTag();
    const saved = await memorise({ content: "cross-project note for the null delete" }, tagA);
    expect(saved.success).toBe(true);
    const { deleteMemorisation, getMemorisationById } =
      await import("../src/services/memorisation-store.js");
    const { CONFIG } = await import("../src/config.js");
    const { linkedSettingsFrom } = await import("../src/services/linked-search.js");
    const linked = linkedSettingsFrom(CONFIG);

    expect(await deleteMemorisation(saved.id as string, null, linked)).toBe("deleted");
    expect(await getMemorisationById(saved.id as string, null, linked)).toBeNull();
  }, 60_000);

  it("reports an ID that exists nowhere", async () => {
    const recalled: any = await operation({ mode: "recall", query: "ms-nope00" }, freshTag());
    expect(recalled.success).toBe(false);
    expect(recalled.error).toContain("ms-nope00");
  }, 60_000);

  it("replace deletes the earlier snapshot of the session and keeps its ID", async () => {
    const tag = freshTag();
    await withConfig({ memorisationRepeat: "replace" }, async () => {
      const first = await memorise({ topic: "release", next: "tag it" }, tag, "session-1");
      const second = await memorise({ topic: "release", done: "tagged" }, tag, "session-1");
      expect(second.id).toBe(first.id);
      expect(second.replaced).toBe(true);

      const recalled: any = await operation({ mode: "recall", query: first.id }, tag);
      expect(recalled.matches[0].content).toBe("Topic: release\nDone: tagged");

      const other = await memorise({ topic: "release" }, tag, "session-2");
      expect(other.id).not.toBe(first.id);
    });
  }, 60_000);

  it("replace keeps the earlier snapshot when the new embedding fails", async () => {
    const tag = freshTag();
    await withConfig({ memorisationRepeat: "replace" }, async () => {
      const first = await memorise({ topic: "release", next: "tag it" }, tag, "session-1");
      const { embeddingService } = await import("../src/services/embedding.js");
      const original = embeddingService.embedWithTimeout.bind(embeddingService);
      (embeddingService as any).embedWithTimeout = async () => {
        throw new Error("embedding down");
      };
      try {
        const failed = await memorise({ topic: "release", done: "tagged" }, tag, "session-1");
        expect(failed.success).toBe(false);
      } finally {
        (embeddingService as any).embedWithTimeout = original;
      }
      const recalled: any = await operation({ mode: "recall", query: first.id }, tag);
      expect(recalled.success).toBe(true);
      expect(recalled.matches[0].content).toBe("Topic: release\nNext: tag it");
    });
  }, 60_000);

  it("replace keeps the earlier snapshot when the insert fails after the delete", async () => {
    const tag = freshTag();
    await withConfig({ memorisationRepeat: "replace" }, async () => {
      const first = await memorise({ topic: "release", next: "tag it" }, tag, "session-1");
      const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
      const original = tursoVectorSearch.insertVectorInTransaction;
      (tursoVectorSearch as any).insertVectorInTransaction = async () => {
        throw new Error("disk full");
      };
      try {
        const failed = await memorise({ topic: "release", done: "tagged" }, tag, "session-1");
        expect(failed.success).toBe(false);
      } finally {
        (tursoVectorSearch as any).insertVectorInTransaction = original;
      }
      const recalled: any = await operation({ mode: "recall", query: first.id }, tag);
      expect(recalled.success).toBe(true);
      expect(recalled.matches[0].content).toBe("Topic: release\nNext: tag it");
    });
  }, 60_000);

  it("add keeps both snapshots of the same session", async () => {
    const tag = freshTag();
    const first = await memorise({ topic: "release" }, tag, "session-1");
    const second = await memorise({ topic: "release", done: "tagged" }, tag, "session-1");
    expect(second.id).not.toBe(first.id);
    for (const id of [first.id, second.id]) {
      const recalled: any = await operation({ mode: "recall", query: id }, tag);
      expect(recalled.success).toBe(true);
    }
  }, 60_000);

  it("recalls a stored record in full after the cap drops below its size", async () => {
    const tag = freshTag();
    const text = `long note ${"z".repeat(290)}`;
    const saved = await memorise({ content: text }, tag);
    expect(saved.success).toBe(true);
    await withConfig({ memorisationMaxSize: 100 }, async () => {
      const refused: any = await memorise({ content: text }, tag);
      expect(refused.success).toBe(false);
      const recalled: any = await operation({ mode: "recall", query: saved.id }, tag);
      expect(recalled.success).toBe(true);
      expect(recalled.matches[0].content).toBe(text);
    });
  }, 60_000);

  it("stores nothing for text over the cap", async () => {
    const tag = freshTag();
    const refused: any = await withConfig({ memorisationMaxSize: 100 }, () =>
      memorise({ content: "y".repeat(300) }, tag)
    );
    expect(refused.success).toBe(false);
    const recalled: any = await operation({ mode: "recall", query: "yyyy" }, tag);
    expect(recalled.count).toBe(0);
  }, 60_000);
});
