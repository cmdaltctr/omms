import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";

/**
 * Recall by text with real embeddings. Every memorisation carries the same
 * `memorisation` tag, so the tags half of the score is near constant. The
 * confidence must come from the content, so a near-exact query clears the
 * one-strong-match rule (80 or more, and a 10 point lead).
 */

let counter = 0;
/** A scope hash per test, so every test reads only its own rows. */
let TAG = "";
const freshTag = () => `omms_project_${`${700 + counter++}`.padStart(16, "0")}`;

const NOTES = {
  port: "Use port 4747 for the scratch web app and never touch the preview port.",
  invoice: "The quarterly invoice export runs on the first Monday and emails finance a CSV file.",
  hiking: "Plan the Scottish hiking trip for late August and book the Glencoe hostel early.",
};

function toolTags() {
  return {
    project: {
      tag: TAG,
      displayName: "Confidence Test",
      userName: "t",
      userEmail: "t@example.com",
    },
    user: { tag: "omms_user_0000000000000000", userName: "t", userEmail: "t@example.com" },
  } as any;
}

async function operation(args: Record<string, unknown>) {
  const { executeMemoryOperation } = await import("../src/core/memory-operations.js");
  return executeMemoryOperation(args as any, {
    directory: process.cwd(),
    host: "pi",
    tags: toolTags(),
  });
}

beforeAll(async () => {
  const { initConfig } = await import("../src/config.js");
  initConfig(process.cwd());
  const { embeddingService } = await import("../src/services/embedding.js");
  await embeddingService.warmup();
}, 120_000);

afterEach(async () => {
  const { cleanupTursoTestDirectory } = await import("./turso-test-utils.js");
  await cleanupTursoTestDirectory();
});

afterAll(async () => {
  const { closeAllCachedSpaceReadStores } =
    await import("../src/services/spaces/read-store-cache.js");
  await closeAllCachedSpaceReadStores();
});

async function saveNotes(): Promise<void> {
  TAG = freshTag();
  for (const content of Object.values(NOTES)) {
    expect((await operation({ mode: "memorise", content })).success).toBe(true);
  }
}

/** Recall with the similarity threshold off, so every note scores. */
async function recall(query: string): Promise<any> {
  const { CONFIG } = await import("../src/config.js");
  const previous = CONFIG.similarityThreshold;
  CONFIG.similarityThreshold = 0;
  try {
    return await operation({ mode: "recall", query, limit: 3 });
  } finally {
    CONFIG.similarityThreshold = previous;
  }
}

describe("memorisation recall confidence", () => {
  it("returns one match for a query that is a near-exact copy of one memorisation", async () => {
    await saveNotes();
    const recalled = await recall("Use port 4747 for the scratch web app");
    expect(recalled.matches).toHaveLength(1);
    expect(recalled.matches[0].content).toBe(NOTES.port);
    expect(recalled.matches[0].confidence).toBeGreaterThanOrEqual(80);
  }, 120_000);

  it("ranks the matching memorisation first for a paraphrase", async () => {
    await saveNotes();
    const recalled = await recall("which port do I use for the scratch web app");
    expect(recalled.matches[0].content).toBe(NOTES.port);
  }, 120_000);

  it("returns one match for the exact text of a memorisation", async () => {
    await saveNotes();
    const recalled = await recall(NOTES.port);
    expect(recalled.matches).toHaveLength(1);
    expect(recalled.matches[0].content).toBe(NOTES.port);
  }, 120_000);
});
