import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const url = (path: string) => new URL(path, import.meta.url).href;
const memoryOperationsUrl = url("../src/core/memory-operations.js");
const clientUrl = url("../src/services/client.js");
const storeUrl = url("../src/services/memorisation-store.js");
const configUrl = url("../src/config.js");
const tagsUrl = url("../src/services/tags.js");
const loggerUrl = url("../src/services/logger.js");
const languageUrl = url("../src/services/language-detector.js");

interface Scenario {
  output: any;
  addCalls: any[];
  deleteCalls: string[];
  searchCalls: any[];
  labelCalls: any[];
  idLookups: string[];
  linkedArgs: any[];
  containerArgs: (string | null)[];
}

/**
 * Runs one operation in a child Bun process with the client, the memorisation
 * store and the config mocked. `body` may seed `state` before the call.
 */
function runScenario(body: string, config: Record<string, unknown> = {}): Scenario {
  const dir = mkdtempSync(join(tmpdir(), "memory-operations-memorise-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const state = {
  records: {},
  sessions: {},
  searchResults: [],
  labelled: [],
  failDelete: false,
  failAdd: false,
};
const addCalls = [];
const deleteCalls = [];
const searchCalls = [];
const labelCalls = [];
const idLookups = [];
const linkedArgs = [];
const containerArgs = [];

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: {
    memory: { defaultScope: "project" },
    autoCaptureLanguage: "en",
    ...${JSON.stringify(config)},
  },
  refreshConfigIfChanged: () => {},
  isConfigured: () => true,
}));

mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    warmup: async () => {},
    ensureStorageReady: async () => {},
    getEmbeddingInitError: () => null,
    addMemory: async (content, containerTag, metadata) => {
      addCalls.push({ content, containerTag, metadata });
      if (state.failAdd) return { success: false, error: "embedding failed" };
      return { success: true, id: metadata.id ?? "mem_generated" };
    },
    deleteMemory: async (memoryId) => {
      deleteCalls.push(memoryId);
      return state.failDelete ? { success: false, error: "nope" } : { success: true };
    },
    searchMemories: async (query, containerTag, scope, options) => {
      searchCalls.push({ query, containerTag, scope, options });
      // An empty tag reads every project, like the real client in the all-projects scope.
      const results = state.searchResults.filter(
        (hit) => containerTag === "" || !hit.containerTag || hit.containerTag === containerTag
      );
      return { success: true, results, total: results.length, timing: 0 };
    },
    close() {},
  },
}));

mock.module(${JSON.stringify(storeUrl)}, () => ({
  getMemorisationById: async (id, containerTag, linked) => {
    idLookups.push(id);
    linkedArgs.push(linked);
    containerArgs.push(containerTag);
    const record = state.records[id];
    if (!record || record.unlinked) return null;
    const recordTag = record.containerTag ?? "opencode_project_test";
    if (containerTag !== null && recordTag !== containerTag) return null;
    const { containerTag: _tag, unlinked: _unlinked, ...stored } = record;
    return stored;
  },
  memorisationIdTaken: async (id, linked) => {
    idLookups.push(id);
    linkedArgs.push(linked);
    return Boolean(state.records[id]);
  },
  findSnapshotByHostSession: async (hostSessionId) => state.sessions[hostSessionId] ?? null,
  // Label recall reads the store for real in memorisation-routes.test.ts; here the
  // rows carry a project tag so the scope of each call is visible.
  listMemorisationsByTags: async (containerTag, tags, scope, limit) => {
    labelCalls.push({ containerTag, tags, scope, limit });
    const memories = state.labelled.filter(
      (memory) => containerTag === "" || !memory.containerTag || memory.containerTag === containerTag
    );
    return { success: true, memories };
  },
}));

mock.module(${JSON.stringify(tagsUrl)}, () => ({
  getTags: () => ({
    project: {
      tag: "opencode_project_test",
      displayName: "Test Project",
      userName: "Test User",
      userEmail: "test@example.com",
      projectPath: "/workspace",
      projectName: "workspace",
      gitRepoUrl: undefined,
    },
    user: { userEmail: "test@example.com", userName: "Test User" },
  }),
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));
mock.module(${JSON.stringify(languageUrl)}, () => ({
  detectLanguage: () => "en",
  getLanguageName: () => "English",
}));

const { executeMemoryOperation } = await import(${JSON.stringify(memoryOperationsUrl)});

let output;
${body}

console.log("RESULT:" + JSON.stringify({ addCalls, deleteCalls, searchCalls, labelCalls, idLookups, linkedArgs, containerArgs, output }));
`;
  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: dir });
  const stdout = proc.stdout.toString();
  const match = stdout.match(/RESULT:(.*)$/m);
  if (!match) {
    throw new Error(`scenario produced no result: ${stdout}\n${proc.stderr.toString()}`);
  }
  return JSON.parse(match[1]!);
}

function run(args: unknown, context: unknown = { directory: "/workspace", host: "opencode" }) {
  return `output = await executeMemoryOperation(${JSON.stringify(args)}, ${JSON.stringify(context)});`;
}

describe("memory tool: memorise", () => {
  it("stores explicit content word for word under a new ms- ID", () => {
    const result = runScenario(
      run({ mode: "memorise", content: "use port 4747 for the scratch web app" })
    );
    expect(result.output.success).toBe(true);
    expect(result.output.id).toMatch(/^ms-[a-z0-9]{6}$/);
    expect(result.addCalls).toHaveLength(1);
    expect(result.addCalls[0].content).toBe("use port 4747 for the scratch web app");
    expect(result.addCalls[0].containerTag).toBe("opencode_project_test");
    expect(result.addCalls[0].metadata).toMatchObject({
      id: result.output.id,
      type: "memorisation",
      memorisation: "explicit",
      host: "opencode",
    });
  });

  it("stores snapshot fields as labelled sections and leaves empty fields out", () => {
    const result = runScenario(
      run(
        {
          mode: "memorise",
          topic: "memorisation proposal",
          done: "proposal written",
          next: "wait for approval",
        },
        { directory: "/workspace", host: "pi", hostSessionId: "session-1" }
      )
    );
    expect(result.output.success).toBe(true);
    expect(result.addCalls[0].content).toBe(
      "Topic: memorisation proposal\nDone: proposal written\nNext: wait for approval"
    );
    expect(result.addCalls[0].metadata).toMatchObject({
      type: "memorisation",
      memorisation: "snapshot",
      hostSessionId: "session-1",
      host: "pi",
    });
  });

  it("accepts memorize as the same mode", () => {
    const result = runScenario(run({ mode: "memorize", content: "release on Friday" }));
    expect(result.output.success).toBe(true);
    expect(result.output.id).toMatch(/^ms-/);
    expect(result.addCalls[0].content).toBe("release on Friday");
    expect(result.addCalls[0].metadata.type).toBe("memorisation");
  });

  it("removes <private> text before storing", () => {
    const result = runScenario(
      run({ mode: "memorise", content: "token is <private>s3cret</private> rotate monthly" })
    );
    expect(result.output.success).toBe(true);
    expect(result.addCalls[0].content).toBe("token is [REDACTED] rotate monthly");
    expect(JSON.stringify(result.addCalls)).not.toContain("s3cret");
  });

  it("refuses content that is entirely private and stores nothing", () => {
    const result = runScenario(
      run({ mode: "memorise", content: "<private>only secrets</private>" })
    );
    expect(result.output).toMatchObject({ success: false, error: "Private content blocked" });
    expect(result.addCalls).toHaveLength(0);
  });

  it("refuses a snapshot whose fields are all private", () => {
    const result = runScenario(
      run({ mode: "memorise", topic: "<private>a</private>", next: "<private>b</private>" })
    );
    expect(result.output).toMatchObject({ success: false, error: "Private content blocked" });
    expect(result.addCalls).toHaveLength(0);
  });

  it("keeps caller tags and always adds the memorisation tag", () => {
    const result = runScenario(
      run({ mode: "memorise", content: "note", tags: "OMMS, release, memorisation" })
    );
    expect(result.addCalls[0].metadata.tags).toEqual([
      "memorisation",
      "omms",
      "release",
      "workspace",
    ]);
    expect(result.output.tags).toEqual(["memorisation", "omms", "release", "workspace"]);
  });

  it("tags a memorisation saved without caller tags", () => {
    const result = runScenario(run({ mode: "memorise", content: "note" }));
    expect(result.addCalls[0].metadata.tags).toEqual(["memorisation", "workspace"]);
  });

  it("stores the project name as a label and returns it", () => {
    const result = runScenario(run({ mode: "memorise", content: "note" }));
    expect(result.addCalls[0].metadata.tags).toEqual(["memorisation", "workspace"]);
    expect(result.output.tags).toEqual(["memorisation", "workspace"]);
  });

  it("does not double the project label the caller already gave", () => {
    const result = runScenario(run({ mode: "memorise", content: "note", tags: "Workspace" }));
    expect(result.addCalls[0].metadata.tags).toEqual(["memorisation", "workspace"]);
  });

  it("refuses when neither content nor a snapshot field is given", () => {
    const result = runScenario(run({ mode: "memorise" }));
    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain("content");
    expect(result.output.error).toContain("topic");
    expect(result.addCalls).toHaveLength(0);
  });

  it("refuses a call with snapshot fields and no mode, instead of returning the help text", () => {
    for (const fields of [{ topic: "Rollout" }, { done: "a" }, { doing: "b" }, { next: "c" }]) {
      const result = runScenario(run(fields));
      expect(result.output).toEqual({
        success: false,
        error: "mode is required: use memorise for snapshot fields",
      });
      expect(result.addCalls).toHaveLength(0);
    }
  });

  it("still returns the help text for a call with no mode and no snapshot fields", () => {
    expect(runScenario(run({})).output.success).toBe(true);
    expect(runScenario(run({ content: "text" })).output.message).toBe("Memory System Usage Guide");
  });

  it("refuses blank content with blank snapshot fields", () => {
    const result = runScenario(run({ mode: "memorise", content: "  ", topic: " " }));
    expect(result.output.success).toBe(false);
    expect(result.addCalls).toHaveLength(0);
  });

  it("refuses content together with snapshot fields", () => {
    const result = runScenario(run({ mode: "memorise", content: "text", topic: "topic" }));
    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain("not both");
    expect(result.addCalls).toHaveLength(0);
  });

  it("returns the error and no ID when the store refuses the write", () => {
    const result = runScenario(
      `state.failAdd = true;\n${run({ mode: "memorise", content: "note" })}`
    );
    expect(result.output.success).toBe(false);
    expect(result.output.id).toBeUndefined();
  });

  it("draws a new ID when the first one is taken", () => {
    const result = runScenario(
      `const realRandom = Math.random;
       let calls = 0;
       Math.random = () => (calls++ === 0 ? 0 : realRandom());
       state.records["ms-000000"] = { id: "ms-000000", content: "taken", createdAt: "2026-01-01T00:00:00.000Z" };
       ${run({ mode: "memorise", content: "note" })}`
    );
    expect(result.output.success).toBe(true);
    expect(result.output.id).not.toBe("ms-000000");
    expect(result.idLookups[0]).toBe("ms-000000");
  });
});

describe("memory tool: add refuses the memorisation type", () => {
  it("refuses type memorisation, points to memorise and stores nothing", () => {
    const result = runScenario(run({ mode: "add", content: "sneaky note", type: "memorisation" }));
    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain("memorise");
    expect(result.addCalls).toHaveLength(0);
  });

  it("still adds an ordinary memory", () => {
    const result = runScenario(run({ mode: "add", content: "plain note", type: "preference" }));
    expect(result.output.success).toBe(true);
    expect(result.addCalls).toHaveLength(1);
    expect(result.addCalls[0].metadata.type).toBe("preference");
  });
});

describe("memory tool: linked-space settings", () => {
  const config = {
    storagePath: "/data/omms",
    embeddingModel: "test-model",
    embeddingDimensions: 8,
  };
  const expected = {
    embeddingModel: "test-model",
    embeddingDimensions: 8,
    globalStoragePath: "/data/omms",
  };

  it("memorise hands the ID lookup the linked settings built from CONFIG", () => {
    const result = runScenario(run({ mode: "memorise", content: "note" }), config);
    expect(result.linkedArgs).toHaveLength(1);
    expect(result.linkedArgs[0]).toMatchObject(expected);
  });

  it("recall by ID hands the lookup the linked settings built from CONFIG", () => {
    const result = runScenario(run({ mode: "recall", query: "ms-zzzzzz" }), config);
    expect(result.linkedArgs).toHaveLength(1);
    expect(result.linkedArgs[0]).toMatchObject(expected);
  });
});

describe("memory tool: recall", () => {
  const record = {
    id: "ms-4k7q2p",
    content: "Topic: release\nNext: tag 4.16.0",
    createdAt: "2026-02-03T04:05:06.000Z",
  };

  it("returns the exact stored text for a memorisation ID without searching", () => {
    const result = runScenario(
      `state.records["ms-4k7q2p"] = ${JSON.stringify(record)};\n${run({ mode: "recall", query: "ms-4k7q2p" })}`
    );
    expect(result.output.success).toBe(true);
    expect(result.output.count).toBe(1);
    expect(result.output.matches).toEqual([record]);
    expect(result.searchCalls).toHaveLength(0);
  });

  it("finds an ID that lives in a linked space and names the space", () => {
    const linked = { ...record, space: "Archive Old" };
    const result = runScenario(
      `state.records["ms-4k7q2p"] = ${JSON.stringify(linked)};\n${run({ mode: "recall", query: " ms-4k7q2p " })}`
    );
    expect(result.output.matches).toEqual([linked]);
    expect(result.idLookups).toEqual(["ms-4k7q2p"]);
  });

  it("looks an ID up across every project of the space", () => {
    const result = runScenario(run({ mode: "recall", query: "ms-zzzzzz" }));
    expect(result.containerArgs).toEqual([null]);
  });

  it("reports an unknown ID without searching by text", () => {
    const result = runScenario(run({ mode: "recall", query: "ms-zzzzzz" }));
    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain("ms-zzzzzz");
    expect(result.searchCalls).toHaveLength(0);
  });

  it("searches memorisations only for text, in the active and linked spaces", () => {
    const result = runScenario(
      `state.searchResults = [{ id: "ms-aaaaaa", memory: "release notes plan", similarity: 0.91, createdAt: 1767225600000, tags: ["memorisation", "Release"] }];
       ${run({ mode: "recall", query: "release notes" })}`
    );
    expect(result.searchCalls).toHaveLength(1);
    expect(result.searchCalls[0]).toMatchObject({
      query: "release notes",
      containerTag: "",
      scope: "all-projects",
      options: { includeLinked: true, kind: "memorisation" },
    });
    // Without labels the search keeps the configured result limit.
    expect(result.searchCalls[0].options).not.toHaveProperty("limit");
    expect(result.output.success).toBe(true);
    expect(result.output.matches).toEqual([
      {
        id: "ms-aaaaaa",
        content: "release notes plan",
        confidence: 91,
        createdAt: "2026-01-01T00:00:00.000Z",
        tags: ["Release"],
      },
    ]);
  });

  it("with tags, reads a wide pool and keeps only hits that carry every label", () => {
    const result = runScenario(
      `state.searchResults = [
         { id: "ms-aaaaaa", memory: "no label", similarity: 0.9, tags: ["memorisation"] },
         { id: "ms-bbbbbb", memory: "one label", similarity: 0.8, tags: ["memorisation", "auth"] },
         { id: "ms-cccccc", memory: "both", similarity: 0.7, tags: ["memorisation", "Auth", "wip"] },
       ];
       ${run({ mode: "recall", query: "notes", tags: " AUTH, wip " })}`
    );
    expect(result.searchCalls[0].options).toMatchObject({ kind: "memorisation", limit: 200 });
    expect(result.output.matches.map((match: any) => match.id)).toEqual(["ms-cccccc"]);
    expect(result.output.matches[0].tags).toEqual(["Auth", "wip"]);
  });

  it("returns one strong match alone", () => {
    const result = runScenario(
      `state.searchResults = [
         { id: "ms-aaaaaa", memory: "top", similarity: 0.88 },
         { id: "ms-bbbbbb", memory: "next", similarity: 0.61 },
       ];
       ${run({ mode: "recall", query: "top" })}`
    );
    expect(result.output.matches.map((match: any) => match.id)).toEqual(["ms-aaaaaa"]);
  });

  it("returns up to three close matches with their scores", () => {
    const result = runScenario(
      `state.searchResults = [
         { id: "ms-aaaaaa", memory: "a", similarity: 0.72, spaceName: "Archive Old" },
         { id: "ms-bbbbbb", memory: "b", similarity: 0.7 },
         { id: "ms-cccccc", memory: "c", similarity: 0.65 },
         { id: "ms-dddddd", memory: "d", similarity: 0.6 },
       ];
       ${run({ mode: "recall", query: "close" })}`
    );
    expect(result.output.matches.map((match: any) => [match.id, match.confidence])).toEqual([
      ["ms-aaaaaa", 72],
      ["ms-bbbbbb", 70],
      ["ms-cccccc", 65],
    ]);
    expect(result.output.matches[0].space).toBe("Archive Old");
  });

  it("honours a smaller limit", () => {
    const result = runScenario(
      `state.searchResults = [
         { id: "ms-aaaaaa", memory: "a", similarity: 0.72 },
         { id: "ms-bbbbbb", memory: "b", similarity: 0.7 },
       ];
       ${run({ mode: "recall", query: "close", limit: 1 })}`
    );
    expect(result.output.matches).toHaveLength(1);
  });

  it("returns more than three close matches when the caller asks for them", () => {
    const result = runScenario(
      `state.searchResults = [
         { id: "ms-aaaaaa", memory: "a", similarity: 0.72 },
         { id: "ms-bbbbbb", memory: "b", similarity: 0.7 },
         { id: "ms-cccccc", memory: "c", similarity: 0.65 },
         { id: "ms-dddddd", memory: "d", similarity: 0.6 },
         { id: "ms-eeeeee", memory: "e", similarity: 0.55 },
         { id: "ms-ffffff", memory: "f", similarity: 0.5 },
       ];
       ${run({ mode: "recall", query: "close", limit: 5 })}`
    );
    expect(result.output.matches.map((match: any) => match.id)).toEqual([
      "ms-aaaaaa",
      "ms-bbbbbb",
      "ms-cccccc",
      "ms-dddddd",
      "ms-eeeeee",
    ]);
    expect(result.output.count).toBe(5);
  });

  it("says nothing matched when the search returns no memorisation", () => {
    const result = runScenario(run({ mode: "recall", query: "unrelated" }));
    expect(result.output.success).toBe(true);
    expect(result.output.count).toBe(0);
    expect(result.output.matches).toEqual([]);
    expect(result.output.message).toContain("No memorisation matched");
  });

  it("requires something to recall", () => {
    const result = runScenario(run({ mode: "recall" }));
    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain("query");
  });
});

describe("memory tool: recall reads every project of the space", () => {
  const otherProject = "opencode_project_omrs";

  it("finds by ID a memorisation saved under another project of the same space", () => {
    const result = runScenario(
      `state.records["ms-omrs01"] = {
         id: "ms-omrs01",
         content: "omrs deploy notes from another project",
         createdAt: "2026-03-04T05:06:07.000Z",
         containerTag: ${JSON.stringify(otherProject)},
       };
       ${run({ mode: "recall", query: "ms-omrs01" })}`
    );
    expect(result.output.success).toBe(true);
    expect(result.output.matches).toEqual([
      {
        id: "ms-omrs01",
        content: "omrs deploy notes from another project",
        createdAt: "2026-03-04T05:06:07.000Z",
      },
    ]);
    expect(result.containerArgs).toEqual([null]);
  });

  it("finds by text a memorisation saved under another project of the same space", () => {
    const result = runScenario(
      `state.searchResults = [
         { id: "ms-omrs02", memory: "omrs runpod notes", similarity: 0.9, createdAt: 1767225600000, containerTag: ${JSON.stringify(otherProject)} },
       ];
       ${run({ mode: "recall", query: "runpod notes" })}`
    );
    expect(result.searchCalls[0]).toMatchObject({
      query: "runpod notes",
      containerTag: "",
      scope: "all-projects",
      options: { includeLinked: true, kind: "memorisation" },
    });
    expect(result.output.success).toBe(true);
    expect(result.output.matches.map((match: any) => match.id)).toEqual(["ms-omrs02"]);
  });

  it("finds by labels a memorisation saved under another project of the same space", () => {
    const result = runScenario(
      `state.labelled = [
         { id: "ms-omrs03", summary: "omrs labelled note", createdAt: "2026-03-04T05:06:07.000Z", tags: ["memorisation", "auth"], containerTag: ${JSON.stringify(otherProject)} },
       ];
       ${run({ mode: "recall", tags: "auth" })}`
    );
    expect(result.labelCalls[0]).toMatchObject({
      containerTag: "",
      tags: ["auth"],
      scope: "all-projects",
      limit: 10,
    });
    expect(result.output.success).toBe(true);
    expect(result.output.matches.map((match: any) => match.id)).toEqual(["ms-omrs03"]);
  });

  it("still reports not found for an ID that exists only in an unlinked space", () => {
    const result = runScenario(
      `state.records["ms-gone01"] = {
         id: "ms-gone01",
         content: "in a space with no link",
         createdAt: "2026-03-04T05:06:07.000Z",
         unlinked: true,
       };
       ${run({ mode: "recall", query: "ms-gone01" })}`
    );
    expect(result.output.success).toBe(false);
    expect(result.output.error).toBe("No memorisation has the ID ms-gone01");
  });
});

describe("memory tool: memorisationRepeat", () => {
  const snapshotArgs = { mode: "memorise", topic: "release", next: "tag it" };
  const withSession = { directory: "/workspace", host: "pi", hostSessionId: "session-1" };
  const earlier = `state.sessions["session-1"] = { id: "ms-4k7q2p" };`;

  it("replace overwrites the earlier snapshot in place under its ID", () => {
    const result = runScenario(`${earlier}\n${run(snapshotArgs, withSession)}`, {
      memorisationRepeat: "replace",
    });
    expect(result.output.success).toBe(true);
    expect(result.output.id).toBe("ms-4k7q2p");
    expect(result.output.replaced).toBe(true);
    expect(result.addCalls).toHaveLength(1);
    expect(result.addCalls[0].metadata).toMatchObject({
      id: "ms-4k7q2p",
      replaceExisting: true,
    });
    // The client swaps the row in one transaction, so the tool never deletes first.
    expect(result.deleteCalls).toHaveLength(0);
  });

  it("replace adds a new ID when the session has no earlier snapshot", () => {
    const result = runScenario(run(snapshotArgs, withSession), { memorisationRepeat: "replace" });
    expect(result.output.success).toBe(true);
    expect(result.output.id).toMatch(/^ms-[a-z0-9]{6}$/);
    expect(result.output.replaced).toBe(false);
    expect(result.deleteCalls).toHaveLength(0);
  });

  it("add keeps both snapshots under different IDs", () => {
    const result = runScenario(`${earlier}\n${run(snapshotArgs, withSession)}`, {
      memorisationRepeat: "add",
    });
    expect(result.output.success).toBe(true);
    expect(result.output.id).not.toBe("ms-4k7q2p");
    expect(result.output.replaced).toBe(false);
    expect(result.deleteCalls).toHaveLength(0);
  });

  it("add is the default", () => {
    const result = runScenario(`${earlier}\n${run(snapshotArgs, withSession)}`);
    expect(result.deleteCalls).toHaveLength(0);
    expect(result.output.id).not.toBe("ms-4k7q2p");
  });

  it("replace without a session ID adds and says it could not replace", () => {
    const result = runScenario(run(snapshotArgs), { memorisationRepeat: "replace" });
    expect(result.output.success).toBe(true);
    expect(result.output.replaced).toBe(false);
    expect(result.output.message).toContain("session");
    expect(result.output.message).toContain("could not replace");
    expect(result.deleteCalls).toHaveLength(0);
    expect(result.addCalls).toHaveLength(1);
  });

  it("explicit memorisations never replace", () => {
    const result = runScenario(
      `${earlier}\n${run({ mode: "memorise", content: "plain note" }, withSession)}`,
      { memorisationRepeat: "replace" }
    );
    expect(result.output.success).toBe(true);
    expect(result.output.id).not.toBe("ms-4k7q2p");
    expect(result.deleteCalls).toHaveLength(0);
  });

  it("replace stores nothing and deletes nothing when the new text is over the cap", () => {
    const result = runScenario(
      `${earlier}\n${run({ ...snapshotArgs, next: "x".repeat(300) }, withSession)}`,
      { memorisationRepeat: "replace", memorisationMaxSize: 100 }
    );
    expect(result.output.success).toBe(false);
    expect(result.deleteCalls).toHaveLength(0);
    expect(result.addCalls).toHaveLength(0);
  });

  it("replace deletes nothing when the write fails, so the earlier snapshot stays", () => {
    const result = runScenario(
      `${earlier}\nstate.failAdd = true;\n${run(snapshotArgs, withSession)}`,
      { memorisationRepeat: "replace" }
    );
    expect(result.output.success).toBe(false);
    expect(result.deleteCalls).toHaveLength(0);
  });
});

describe("memory tool: memorisation size cap", () => {
  it("refuses text over the default 2000 characters and stores nothing", () => {
    const result = runScenario(run({ mode: "memorise", content: "x".repeat(2600) }));
    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain("2000 characters");
    expect(result.output.error).toContain("2600");
    expect(result.addCalls).toHaveLength(0);
  });

  it("stores text exactly at the cap", () => {
    const result = runScenario(run({ mode: "memorise", content: "x".repeat(2000) }));
    expect(result.output.success).toBe(true);
    expect(result.addCalls).toHaveLength(1);
  });

  it("measures in estimated tokens when the unit is tokens", () => {
    const config = { memorisationMaxSize: 300, memorisationSizeUnit: "tokens" };
    const tooLong = runScenario(run({ mode: "memorise", content: "x".repeat(1640) }), config);
    expect(tooLong.output.success).toBe(false);
    expect(tooLong.output.error).toContain("300 tokens");
    expect(tooLong.output.error).toContain("about 410 tokens");
    expect(tooLong.addCalls).toHaveLength(0);

    const fits = runScenario(run({ mode: "memorise", content: "x".repeat(1200) }), config);
    expect(fits.output.success).toBe(true);
  });

  it("counts the stored text after <private> removal and after snapshot labels", () => {
    const hidden = runScenario(
      run({ mode: "memorise", content: `note <private>${"x".repeat(5000)}</private>` })
    );
    expect(hidden.output.success).toBe(true);

    const labelled = runScenario(run({ mode: "memorise", topic: "x".repeat(95) }), {
      memorisationMaxSize: 100,
    });
    expect(labelled.output.success).toBe(false);
    expect(labelled.addCalls).toHaveLength(0);
  });

  it("uses the configured cap, so a lowered cap refuses text the default allows", () => {
    const result = runScenario(run({ mode: "memorise", content: "x".repeat(500) }), {
      memorisationMaxSize: 400,
    });
    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain("400 characters");
  });
});
