import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The Claude Code recall rows parse the context the hooks inject. The parser
 * (`hooks/omms-recall-parse.js`) runs inside Claude Code, where `ci:local` never
 * runs it. This test feeds it the real output of each OMMS function that builds
 * a recall section, so a change to that text fails here and not on screen.
 */

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const url = (path: string) => new URL(path, import.meta.url).href;

/** Builds the three injected sections in a fresh process, so module mocks do not leak. */
function buildSections(): { prompt: string; fresh: string; restored: string; cut: string } {
  const dir = mkdtempSync(join(tmpdir(), "omms-recall-contract-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  writeFileSync(
    scriptPath,
    `
import { mock } from "bun:test";

const rows = [
  { id: "mem_alpha", similarity: 0.67, memory: "## Request\\nUser asked to add a claude-adapter.\\n\\n## Outcome\\nStarted." },
  { id: "mem_beta", similarity: 0.62, memory: "OMMS global embeddings use llama.cpp." },
];
const recent = [
  { id: "mem_recent", summary: "Release 4.4 shipped.", createdAt: new Date().toISOString(), metadata: {} },
];

mock.module(${JSON.stringify(url("../src/config.js"))}, () => ({
  CONFIG: { injectProfile: false, chatMessage: { excludeCurrentSession: false } },
}));
mock.module(${JSON.stringify(url("../src/services/user-profile/profile-context.js"))}, () => ({
  getUserProfileContext: async () => null,
}));
mock.module(${JSON.stringify(url("../src/services/tags.js"))}, () => ({
  getTags: () => ({ project: { tag: "omms_project_test" }, user: { userEmail: null } }),
}));
mock.module(${JSON.stringify(url("../src/services/client.js"))}, () => ({
  memoryClient: {
    searchMemories: async () => ({ success: true, results: rows }),
    listMemories: async () => ({ success: true, memories: recent }),
  },
}));

const {
  buildRetrievalSection,
  buildRecentMemoriesSection,
  formatMemoriesForCompaction,
  wrapRetrievalSection,
} = await import(${JSON.stringify(url("../src/core/retrieval.js"))});
const { truncateContext } = await import(${JSON.stringify(url("../src/adapters/claude-code/hook-client.js"))});

const prompt = wrapRetrievalSection(await buildRetrievalSection("how did we add the adapter", "/work", "ses-1"));
const fresh = wrapRetrievalSection(
  await buildRecentMemoriesSection({ projectTag: "omms_project_test", userEmail: null, sessionId: "ses-1", maxMemories: 3 })
);
const restored = wrapRetrievalSection(
  formatMemoriesForCompaction([
    { id: "mem_wal", memory: "Use WAL mode", tags: ["db"] },
    { id: "mem_queue", memory: "## Request\\nRetry the queue on a lock." },
  ])
);
// Claude Code caps hook context, and the hook cuts the text to fit. The cut
// keeps the closing tag, so leave room for it after the second memory's start.
const cut = truncateContext(prompt, prompt.indexOf("OMMS global") + 10 + "\\n</omms-retrieval>".length);
console.log(JSON.stringify({ prompt, fresh, restored, cut }));
`
  );
  const proc = Bun.spawnSync(["bun", scriptPath], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(new TextDecoder().decode(proc.stderr));
  const stdout = new TextDecoder().decode(proc.stdout).trim();
  return JSON.parse(stdout.split("\n").pop()!);
}

const loadParser = () => import("../hooks/omms-recall-parse.js");

describe("recall parser against real OMMS output", () => {
  it("reads a prompt section: count, relevance, id and headline", async () => {
    const { recalledIn } = await loadParser();
    expect(recalledIn(buildSections().prompt)).toEqual([
      { relevance: 67, id: "mem_alpha", text: "User asked to add a claude-adapter." },
      { relevance: 62, id: "mem_beta", text: "OMMS global embeddings use llama.cpp." },
    ]);
  });

  it("reads a fresh-session section", async () => {
    const { recalledIn } = await loadParser();
    expect(recalledIn(buildSections().fresh)).toEqual([
      { relevance: 100, id: "mem_recent", text: "Release 4.4 shipped." },
    ]);
  });

  it("reads a restored-session section, which has ids and no relevance", async () => {
    const { recalledIn } = await loadParser();
    expect(recalledIn(buildSections().restored)).toEqual([
      { relevance: null, id: "mem_wal", text: "Use WAL mode" },
      { relevance: null, id: "mem_queue", text: "Retry the queue on a lock." },
    ]);
  });

  it("still reads a section the hook cut short", async () => {
    const { recalledIn } = await loadParser();
    const found = recalledIn(buildSections().cut);
    expect(found.map((item: { id: string }) => item.id)).toEqual(["mem_alpha", "mem_beta"]);
  });

  it("finds nothing in hook context that holds no OMMS section", async () => {
    const { recalledIn } = await loadParser();
    expect(recalledIn("some other hook context")).toEqual([]);
    expect(recalledIn('<memory id="x" relevance="50%">\nnot inside a section\n</memory>')).toEqual(
      []
    );
  });

  it("titles a call the way a tool row does", async () => {
    const { callTitle } = await loadParser();
    const items = [{ relevance: 80, id: "a", text: "a" }];
    expect(callTitle({ mode: "search", query: "find\n the thing", items })).toBe(
      'memory [mode=search, query="find the thing", limit=1]'
    );
    expect(callTitle({ mode: "recent", query: null, items })).toBe("memory [mode=recent, limit=1]");
  });
});
