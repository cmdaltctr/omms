import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openingQueryFor } from "../src/core/opening-context.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const openingUrl = new URL("../src/core/opening-context.js", import.meta.url).href;
const retrievalUrl = new URL("../src/core/retrieval.js", import.meta.url).href;
const clientUrl = new URL("../src/services/client.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const contextServiceUrl = new URL("../src/services/context.js", import.meta.url).href;

/**
 * Runs `code` with a stubbed store. `results` maps a query to its search results.
 * The formatter stub records each call and returns `<memory_context>ids</memory_context>`,
 * or fills the whole budget when `fill` is set.
 */
function runScenario(code: string, excludeCurrentSession = true): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-opening-context-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

const searchQueries = [];
const formatted = [];
let results = {};
let fill = false;
let started = 0;
let release;
const bothStarted = new Promise((resolve) => (release = resolve));
const overlap = [];

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: { chatMessage: { excludeCurrentSession: ${excludeCurrentSession} } },
}));

mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    searchMemories: async (...args) => {
      searchQueries.push(args);
      started += 1;
      if (started === 2) release();
      // Wait briefly for a second search: two searches in parallel both see started === 2.
      await Promise.race([bothStarted, new Promise((resolve) => setTimeout(resolve, 200))]);
      overlap.push(started);
      const found = results[args[0]] ?? [];
      return { success: true, results: found, total: found.length, timing: 0, queryVector: [0.5] };
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
  formatContextForPrompt: async (userId, memories, budget, queryVector) => {
    formatted.push({ userId, ids: memories.results.map((r) => r.id), budget, queryVector });
    if (fill) return "x".repeat(budget.maxBytes - (budget.wrapperBytes ?? 0));
    return "<memory_context>" + memories.results.map((r) => r.id).join("|") + "</memory_context>";
  },
}));

const { buildFirstPromptSections } = await import(${JSON.stringify(openingUrl)});
const { buildRetrievalSection, retrievalWrapperBytes, wrapRetrievalSection } = await import(${JSON.stringify(retrievalUrl)});
const wrapper = retrievalWrapperBytes();
const memory = (id, sessionID = "ses-other") => ({ id, memory: id, similarity: 0.9, metadata: { sessionID } });
let captured;
${code}
console.log(JSON.stringify({ captured, searchQueries, formatted, overlap, wrapper }));
`;

  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", scriptPath], { stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(proc.stdout).trim();
  if (proc.exitCode !== 0) throw new Error(new TextDecoder().decode(proc.stderr));
  return JSON.parse(stdout.split("\n").pop()!);
}

const call = (extra = "") =>
  `captured = await buildFirstPromptSections({ prompt: "fix the queue", openingQuery: "project setup",
     directory: "/repo", sessionId: "ses-1", budget: { maxBytes: 4000, wrapperBytes: wrapper },
     openingReserveBytes: 50${extra} });`;

describe("openingQueryFor", () => {
  it("returns null when the option is off", () => {
    expect(openingQueryFor({ openingContext: false, openingContextQuery: "setup" })).toBeNull();
  });

  it("returns null when the query is empty", () => {
    expect(openingQueryFor({ openingContext: true, openingContextQuery: "" })).toBeNull();
    expect(openingQueryFor({ openingContext: true, openingContextQuery: "  \n " })).toBeNull();
  });

  it("returns the trimmed query when the option is on", () => {
    expect(openingQueryFor({ openingContext: true, openingContextQuery: "  setup \n" })).toBe(
      "setup"
    );
  });
});

describe("buildFirstPromptSections", () => {
  it("runs both searches in parallel, with the same arguments as buildRetrievalSection", () => {
    const output = runScenario(`
results = { "fix the queue": [memory("a")], "project setup": [memory("b")] };
${call()}
`);
    expect(output.searchQueries).toEqual([
      ["fix the queue", "omms_project_test"],
      ["project setup", "omms_project_test"],
    ]);
    // Each search saw the other one start before it finished.
    expect(output.overlap).toEqual([2, 2]);
    const single = runScenario(`await buildRetrievalSection("fix the queue", "/repo", "ses-1");`);
    expect(single.searchQueries).toEqual([["fix the queue", "omms_project_test"]]);
  });

  it("returns the prompt section first, wrapped as hosts wrap buildRetrievalSection", () => {
    const output = runScenario(`
results = { "fix the queue": [memory("a")], "project setup": [memory("b")] };
${call()}
const single = await buildRetrievalSection("fix the queue", "/repo", "ses-1", { maxBytes: 4000, wrapperBytes: wrapper });
captured.same = captured.promptSection === wrapRetrievalSection(single);
`);
    expect(output.captured.promptSection).toBe(
      "<omms-retrieval>\n<memory_context>a</memory_context>\n</omms-retrieval>"
    );
    expect(output.captured.openingSection).toBe(
      "<omms-retrieval>\n<memory_context>b</memory_context>\n</omms-retrieval>"
    );
    expect(output.captured.same).toBe(true);
  });

  it("drops opening results that the prompt results hold", () => {
    const output = runScenario(`
results = {
  "fix the queue": [memory("a"), memory("b")],
  "project setup": [memory("b"), memory("c")],
};
${call()}
`);
    expect(output.formatted.map((entry: { ids: string[] }) => entry.ids)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("packs the prompt section with the full budget and the opening with what is left", () => {
    const output = runScenario(`
results = { "fix the queue": [memory("a")], "project setup": [memory("b")] };
${call()}
`);
    const [prompt, opening] = output.formatted;
    expect(prompt).toEqual({
      userId: "user@example.com",
      ids: ["a"],
      budget: { maxBytes: 4000, wrapperBytes: output.wrapper },
      queryVector: [0.5],
    });
    const promptBytes = "<memory_context>a</memory_context>".length + output.wrapper;
    // No profile in the opening section: the prompt section already holds it.
    expect(opening.userId).toBeNull();
    expect(opening.budget).toEqual({
      maxBytes: 4000 - promptBytes - 50,
      wrapperBytes: output.wrapper,
    });
  });

  it("gives the opening section the whole budget minus the reserve when the prompt finds nothing", () => {
    const output = runScenario(`
results = { "project setup": [memory("b")] };
${call()}
`);
    expect(output.captured.promptSection).toBeNull();
    expect(output.captured.openingSection).toContain("<memory_context>b</memory_context>");
    expect(output.formatted).toHaveLength(1);
    expect(output.formatted[0].budget).toEqual({ maxBytes: 3950, wrapperBytes: output.wrapper });
  });

  it("reserves the tag when the budget names no wrapper bytes", () => {
    const output = runScenario(`
results = { "fix the queue": [memory("a")], "project setup": [memory("b")] };
captured = await buildFirstPromptSections({ prompt: "fix the queue", openingQuery: "project setup",
  directory: "/repo", sessionId: "ses-1", budget: { maxBytes: 4000 }, openingReserveBytes: 0 });
`);
    expect(output.formatted.map((entry: { budget: unknown }) => entry.budget)).toEqual([
      { maxBytes: 4000, wrapperBytes: output.wrapper },
      {
        maxBytes: 4000 - "<memory_context>a</memory_context>".length - output.wrapper,
        wrapperBytes: output.wrapper,
      },
    ]);
  });

  it("returns no opening section when the prompt section fills the budget", () => {
    const output = runScenario(`
results = { "fix the queue": [memory("a")], "project setup": [memory("b")] };
fill = true;
${call()}
`);
    expect(output.captured.promptSection).not.toBeNull();
    expect(output.captured.openingSection).toBeNull();
    expect(output.formatted).toHaveLength(1);
    expect(output.captured.promptSection.length).toBe(4000);
  });

  it("returns no opening section when nothing matches the query or every match is a duplicate", () => {
    const none = runScenario(`
results = { "fix the queue": [memory("a")] };
${call()}
`);
    expect(none.captured.openingSection).toBeNull();
    const duplicate = runScenario(`
results = { "fix the queue": [memory("a")], "project setup": [memory("a")] };
${call()}
`);
    expect(duplicate.captured.openingSection).toBeNull();
    expect(duplicate.formatted).toHaveLength(1);
  });

  it("drops current-session memories from both searches when configured", () => {
    const output = runScenario(`
results = {
  "fix the queue": [memory("own-a", "ses-1"), memory("a")],
  "project setup": [memory("own-b", "ses-1"), memory("b")],
};
${call()}
`);
    expect(output.formatted.map((entry: { ids: string[] }) => entry.ids)).toEqual([["a"], ["b"]]);
  });

  it("keeps current-session memories in both searches when exclusion is off", () => {
    const output = runScenario(
      `
results = { "fix the queue": [memory("own-a", "ses-1")], "project setup": [memory("own-b", "ses-1")] };
${call()}
`,
      false
    );
    expect(output.formatted.map((entry: { ids: string[] }) => entry.ids)).toEqual([
      ["own-a"],
      ["own-b"],
    ]);
  });

  it("runs one search and adds no opening section without a query", () => {
    const output = runScenario(`
results = { "fix the queue": [memory("a")], "project setup": [memory("b")] };
captured = await buildFirstPromptSections({ prompt: "fix the queue", openingQuery: null,
  directory: "/repo", sessionId: "ses-1", budget: { maxBytes: 4000, wrapperBytes: wrapper },
  openingReserveBytes: 0 });
`);
    expect(output.searchQueries).toEqual([["fix the queue", "omms_project_test"]]);
    expect(output.captured.openingSection).toBeNull();
    expect(output.captured.promptSection).toContain("a");
  });

  it("skips both searches for an empty prompt", () => {
    const output = runScenario(`
results = { "project setup": [memory("b")] };
captured = await buildFirstPromptSections({ prompt: "   ", openingQuery: "project setup",
  directory: "/repo", sessionId: "ses-1", budget: { maxBytes: 4000, wrapperBytes: wrapper },
  openingReserveBytes: 0 });
`);
    expect(output.captured).toEqual({ promptSection: null, openingSection: null });
    expect(output.searchQueries).toEqual([]);
  });
});
