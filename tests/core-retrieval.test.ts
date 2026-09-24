import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatMemoriesForCompaction, wrapRetrievalSection } from "../src/core/retrieval.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const retrievalUrl = new URL("../src/core/retrieval.js", import.meta.url).href;
const clientUrl = new URL("../src/services/client.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const contextServiceUrl = new URL("../src/services/context.js", import.meta.url).href;

function runScenario(code: string, excludeCurrentSession = true): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-core-retrieval-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

const searchQueries = [];
const formatted = [];
let results = [];

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: { chatMessage: { excludeCurrentSession: ${excludeCurrentSession} } },
}));

mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    searchMemories: async (query, tag) => {
      searchQueries.push([query, tag]);
      return { success: true, results, total: results.length, timing: 0 };
    },
  },
}));

mock.module(${JSON.stringify(tagsUrl)}, () => ({
  getTags: () => ({
    project: { tag: "omms_project_test" },
    user: { userEmail: "user@example.com" },
  }),
}));

mock.module(${JSON.stringify(contextServiceUrl)}, () => ({
  formatContextForPrompt: async (userId, memories) => {
    formatted.push([userId, memories.results.map((r) => r.id)]);
    return "<memory_context>" + memories.results.map((r) => r.memory).join("|") + "</memory_context>";
  },
}));

const { buildRetrievalSection } = await import(${JSON.stringify(retrievalUrl)});
let captured;
${code}
console.log(JSON.stringify({ captured, searchQueries, formatted }));
`;

  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", scriptPath], { stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(proc.stdout).trim();
  if (proc.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(proc.stderr));
  }
  return JSON.parse(stdout.split("\n").pop()!);
}

describe("shared retrieval", () => {
  it("skips the search for an empty prompt", () => {
    const output = runScenario(`captured = await buildRetrievalSection("   ", "/repo", "ses-1");`);
    expect(output.captured).toBeNull();
    expect(output.searchQueries).toEqual([]);
  });

  it("returns null when nothing relevant is found", () => {
    const output = runScenario(
      `captured = await buildRetrievalSection("queue?", "/repo", "ses-1");`
    );
    expect(output.captured).toBeNull();
    expect(output.searchQueries).toEqual([["queue?", "omms_project_test"]]);
    expect(output.formatted).toEqual([]);
  });

  it("excludes memories from the current session when configured", () => {
    const output = runScenario(`
results = [
  { id: "own", memory: "from this session", similarity: 0.9, metadata: { sessionID: "ses-1" } },
  { id: "other", memory: "from another session", similarity: 0.8, metadata: { sessionID: "ses-2" } },
];
captured = await buildRetrievalSection("queue?", "/repo", "ses-1");
`);
    expect(output.captured).toBe("<memory_context>from another session</memory_context>");
    expect(output.formatted).toEqual([["user@example.com", ["other"]]]);
  });

  it("keeps current-session memories when exclusion is disabled", () => {
    const output = runScenario(
      `
results = [
  { id: "own", memory: "from this session", similarity: 0.9, metadata: { sessionID: "ses-1" } },
];
captured = await buildRetrievalSection("queue?", "/repo", "ses-1");
`,
      false
    );
    expect(output.formatted).toEqual([["user@example.com", ["own"]]]);
  });

  it("wraps a section in the omms-retrieval tag", () => {
    expect(wrapRetrievalSection("body")).toBe("<omms-retrieval>\nbody\n</omms-retrieval>");
  });

  it("formats restored session memories and strips a matching tags footer", () => {
    const text = formatMemoriesForCompaction([
      { memory: "Use WAL mode\n\nTags: db, queue", tags: ["queue", "db"] },
    ]);
    expect(text).toBe(
      "## Restored Session Memory\n\n### Memory 1\nUse WAL mode\n\nTags: queue, db\n\n"
    );
  });
});
