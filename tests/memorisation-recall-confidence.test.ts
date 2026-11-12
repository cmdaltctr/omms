import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Recall by text with real embeddings. Every memorisation carries the same
 * `memorisation` tag, so the tags half of the score is near constant. The
 * confidence must come from the content, so a near-exact query clears the
 * one-strong-match rule (80 or more, and a 10 point lead).
 *
 * Recall reads every project of the space, so rows from earlier tests in this
 * file stay visible: every test saves a note on its own port topic, and the
 * queries name that topic. The rerank tests drive recall through a real HTTP
 * reranker server, a closed port, or no server at all.
 */

let counter = 0;
/** A scope hash per test, so every test saves under its own project tag. */
let TAG = "";
const freshTag = () => `omms_project_${`${700 + counter++}`.padStart(16, "0")}`;

/** Two filler notes, so a query always has competition inside its own save. */
const FILLER = {
  invoice: "The quarterly invoice export runs on the first Monday and emails finance a CSV file.",
  hiking: "Plan the Scottish hiking trip for late August and book the Glencoe hostel early.",
};

/** Every test's port note is on its own topic, so no query reaches another test's note. */
const TOPICS = {
  nearExact: {
    note: "Use port 4747 for the scratch web app and never touch the preview port.",
    query: "Use port 4747 for the scratch web app",
  },
  paraphrase: {
    note: "The standby metrics port is 5050 and must stay open overnight.",
    query: "which port do I use for the metrics dashboard",
  },
  exact: {
    note: "The print queue listens on port 6033 on the office network.",
  },
  rerankOrder: {
    note: "The database proxy tunnels through port 4040 with a keepalive of thirty seconds.",
    // Mid-strength on purpose: three matches must come back, not one strong one.
    query: "which port is the tunnel on",
  },
  rerankOff: {
    note: "The staging server always answers on port 8081 behind the office firewall.",
    query: "which port do I use for the staging server",
  },
  rerankFail: {
    note: "The label printer takes port 9100 on the second floor.",
    query: "which port do I use for the label printer",
  },
  noServer: {
    note: "The build cache mirrors on port 8333 during the nightly job.",
    query: "which port do I use for the build cache",
  },
  rerankThreshold: {
    note: "The garden shed key hangs on the blue hook by the back door.",
    // Unrelated to every note in this file, so no match clears a real threshold.
    query: "favourite pizza topping in Naples",
  },
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

/** Saves the test's port note plus the two fillers, and returns every saved text. */
async function saveNotes(topic: { note: string }): Promise<string[]> {
  TAG = freshTag();
  const contents = [topic.note, FILLER.invoice, FILLER.hiking];
  for (const content of contents) {
    expect((await operation({ mode: "memorise", content })).success).toBe(true);
  }
  return contents;
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

interface RerankPatch {
  memorisationRerank: boolean;
  rerankerEnabled: boolean;
  apiUrl?: string;
  model?: string;
}

/** One recall with the reranker keys replaced, then restored. */
async function recallWithRerank(query: string, patch: RerankPatch): Promise<any> {
  const { CONFIG } = await import("../src/config.js");
  const before = {
    memorisationRerank: CONFIG.memorisationRerank,
    rerankerEnabled: CONFIG.rerankerEnabled,
    rerankerApiUrl: CONFIG.rerankerApiUrl,
    rerankerModel: CONFIG.rerankerModel,
  };
  Object.assign(CONFIG, patch, { rerankerApiUrl: patch.apiUrl, rerankerModel: patch.model });
  try {
    return await recall(query);
  } finally {
    Object.assign(CONFIG, before);
  }
}

/** The log lines this run added, so a test can check codes without old noise. */
function newLogLines(before: string): string {
  const file = process.env.OMMS_LOG_FILE;
  return file ? readFileSync(file, "utf8").slice(before.length) : "";
}

describe("memorisation recall confidence", () => {
  it("returns one match for a query that is a near-exact copy of one memorisation", async () => {
    await saveNotes(TOPICS.nearExact);
    const recalled = await recall(TOPICS.nearExact.query);
    expect(recalled.matches).toHaveLength(1);
    expect(recalled.matches[0].content).toBe(TOPICS.nearExact.note);
    expect(recalled.matches[0].confidence).toBeGreaterThanOrEqual(80);
  }, 120_000);

  it("ranks the matching memorisation first for a paraphrase", async () => {
    await saveNotes(TOPICS.paraphrase);
    const recalled = await recall(TOPICS.paraphrase.query);
    expect(recalled.matches[0].content).toBe(TOPICS.paraphrase.note);
  }, 120_000);

  it("returns one match for the exact text of a memorisation", async () => {
    await saveNotes(TOPICS.exact);
    const recalled = await recall(TOPICS.exact.note);
    expect(recalled.matches).toHaveLength(1);
    expect(recalled.matches[0].content).toBe(TOPICS.exact.note);
  }, 120_000);
});

describe("memorisation recall rerank", () => {
  it("keeps the reranker's order and each match's own confidence when rerank is on", async () => {
    await saveNotes(TOPICS.rerankOrder);
    const plain = await recall(TOPICS.rerankOrder.query);
    expect(plain.matches).toHaveLength(3);
    // The server puts the plain result's own three notes on top, reversed.
    // Every other document scores zero, so pool size cannot change the answer.
    const plainOrder = plain.matches.map((match: any) => match.content);
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = await request.json();
        const results = body.documents.map((document: string, index: number) => {
          const place = plainOrder.indexOf(document);
          return { index, relevance_score: place === -1 ? 0 : place + 1 };
        });
        return Response.json({ results });
      },
    });
    try {
      const reranked = await recallWithRerank(TOPICS.rerankOrder.query, {
        memorisationRerank: true,
        rerankerEnabled: false,
        apiUrl: `http://127.0.0.1:${server.port}/v1`,
        model: "test-reranker",
      });
      expect(reranked.matches).toHaveLength(3);
      expect(reranked.matches.map((match: any) => match.content)).toEqual(
        [...plainOrder].reverse()
      );
      for (const match of reranked.matches) {
        const same = plain.matches.find((candidate: any) => candidate.content === match.content);
        expect(match.confidence).toBe(same.confidence);
      }
    } finally {
      server.stop(true);
    }
  }, 120_000);

  it("does not call the reranker when memorisationRerank is off, even with the server set", async () => {
    await saveNotes(TOPICS.rerankOff);
    const plain = await recall(TOPICS.rerankOff.query);
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        calls++;
        return Response.json({ results: [] });
      },
    });
    try {
      const off = await recallWithRerank(TOPICS.rerankOff.query, {
        memorisationRerank: false,
        rerankerEnabled: true,
        apiUrl: `http://127.0.0.1:${server.port}/v1`,
        model: "test-reranker",
      });
      expect(off.matches.map((match: any) => match.content)).toEqual(
        plain.matches.map((match: any) => match.content)
      );
      expect(calls).toBe(0);
    } finally {
      server.stop(true);
    }
  }, 120_000);

  it("returns the confidence order and logs one code when the reranker fails", async () => {
    await saveNotes(TOPICS.rerankFail);
    const plain = await recall(TOPICS.rerankFail.query);
    const file = process.env.OMMS_LOG_FILE;
    expect(file).toBeTruthy();
    const before = file ? readFileSync(file, "utf8") : "";
    const failed = await recallWithRerank(TOPICS.rerankFail.query, {
      memorisationRerank: true,
      rerankerEnabled: false,
      // Nothing listens here, so the reranker call fails.
      apiUrl: "http://127.0.0.1:9/v1",
      model: "test-reranker",
    });
    expect(failed.matches.map((match: any) => match.content)).toEqual(
      plain.matches.map((match: any) => match.content)
    );
    const added = newLogLines(before);
    expect(added).toContain("reranker_unreachable");
    // Metadata only: the log holds the code, never the notes or the query.
    expect(added).not.toContain(TOPICS.rerankFail.note);
    expect(added).not.toContain(TOPICS.rerankFail.query);
  }, 120_000);

  it("searches in confidence order and logs the code when rerank is on without a server", async () => {
    await saveNotes(TOPICS.noServer);
    const plain = await recall(TOPICS.noServer.query);
    const file = process.env.OMMS_LOG_FILE;
    expect(file).toBeTruthy();
    const before = file ? readFileSync(file, "utf8") : "";
    const silent = await recallWithRerank(TOPICS.noServer.query, {
      memorisationRerank: true,
      // Even the general switch is on: with no URL or model there is no reranker.
      rerankerEnabled: true,
    });
    expect(silent.matches.map((match: any) => match.content)).toEqual(
      plain.matches.map((match: any) => match.content)
    );
    expect(newLogLines(before)).toContain("reranker_not_configured");
  }, 120_000);

  it("keeps the similarity threshold when rerank is on", async () => {
    await saveNotes(TOPICS.rerankThreshold);
    // A reranker that ranks every document highly, so only the threshold can drop one.
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = await request.json();
        const results = body.documents.map((_: string, index: number) => ({
          index,
          relevance_score: 1 - index / 1000,
        }));
        return Response.json({ results });
      },
    });
    const { CONFIG } = await import("../src/config.js");
    const before = {
      memorisationRerank: CONFIG.memorisationRerank,
      rerankerApiUrl: CONFIG.rerankerApiUrl,
      rerankerModel: CONFIG.rerankerModel,
      similarityThreshold: CONFIG.similarityThreshold,
    };
    Object.assign(CONFIG, {
      memorisationRerank: true,
      rerankerApiUrl: `http://127.0.0.1:${server.port}/v1`,
      rerankerModel: "test-reranker",
      similarityThreshold: 0.6,
    });
    try {
      const recalled: any = await operation({
        mode: "recall",
        query: TOPICS.rerankThreshold.query,
      });
      expect(recalled.success).toBe(true);
      for (const match of recalled.matches) expect(match.confidence).toBeGreaterThanOrEqual(60);
      expect(recalled.matches).toHaveLength(0);
    } finally {
      Object.assign(CONFIG, before);
      server.stop(true);
    }
  }, 120_000);
});
