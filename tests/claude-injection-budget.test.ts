import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runBunProcess, TEST_PARENT_TIMEOUT_MS } from "./test-process.js";

// Task 4.3 for Claude Code: every section the hook api returns (prompt
// retrieval, opening section, compaction/resume restore) is
// packed within the configured retrievalMaxTokens budget with the wrapper
// reserved, a later config edit applies to the next request, and the hook
// client's fixed transport cap keeps the wrapper closed on top of the budget.
// Each scenario runs in its own process with a temporary HOME and store.

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const moduleUrl = (path: string) => pathToFileURL(join(import.meta.dir, "..", path)).href;

function createHarness(
  initialTokens: number,
  extraConfig: Record<string, unknown> = {}
): {
  home: string;
  projectDir: string;
  run: (code: string) => Promise<any>;
} {
  const home = mkdtempSync(join(tmpdir(), "omms-claude-budget-home-"));
  const projectDir = mkdtempSync(join(tmpdir(), "omms-claude-budget-project-"));
  tempDirs.push(home, projectDir);
  const configPath = join(home, ".config", "omms", "omms.jsonc");
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  const writeConfig = (tokens: number) =>
    writeFileSync(
      configPath,
      JSON.stringify({
        storagePath: join(home, "store"),
        embeddingDimensions: 4,
        userEmailOverride: "dev@example.com",
        injectProfile: false,
        retrievalMaxTokens: tokens,
        ...extraConfig,
      })
    );
  writeConfig(initialTokens);

  const run = async (code: string): Promise<any> => {
    const script = `
const { mock } = await import("bun:test");
const embeddingStub = {
  embedWithTimeout: async () => new Float32Array([0.25, 0.5, 0.75, 1]),
  warmup: async () => {},
  isWarmedUp: true,
};
mock.module(${JSON.stringify(moduleUrl("src/services/embedding.js"))}, () => ({
  embeddingService: embeddingStub,
  EmbeddingService: class { static getInstance() { return embeddingStub; } },
  applyEmbeddingTaskPrefix: (_model, text) => text,
  loadLocalTransformersBackend: async () => null,
}));
mock.module(${JSON.stringify(moduleUrl("src/services/turso/ready.js"))}, () => ({
  ensureTursoReady: async () => {},
  resetTursoReady: () => {},
}));
const logs = [];
mock.module(${JSON.stringify(moduleUrl("src/services/logger.js"))}, () => ({
  log: (message, data) => logs.push({ message, data: data ?? null }),
}));

const { writeFileSync: wf } = await import("node:fs");
const config = await import(${JSON.stringify(moduleUrl("src/config.js"))});
const projectDir = ${JSON.stringify(projectDir)};
config.initConfig(projectDir);
const { memoryClient } = await import(${JSON.stringify(moduleUrl("src/services/client.js"))});
const { getTags } = await import(${JSON.stringify(moduleUrl("src/services/tags.js"))});
const api = await import(${JSON.stringify(moduleUrl("src/importer/claude-hook-api.js"))});
const { truncateContext, CLAUDE_CONTEXT_LIMIT } = await import(${JSON.stringify(
      moduleUrl("src/adapters/claude-code/hook-client.js")
    )});

const byteLength = (text) => Buffer.byteLength(text, "utf8");
const closed = (text) =>
  text.startsWith("<omms-retrieval>") && text.endsWith("</omms-retrieval>");
const sectionOf = async (body) => (await api.handleClaudeRetrieve(body)).additionalContext;

// Seed one big recent memory per project tag and three claude-code session memories.
const tag = getTags(projectDir).project.tag;
const big = "Claude prefers short answers with code first ".repeat(400);
await memoryClient.addMemory(big, tag, { sessionID: "seed-session", host: "claude-code" });
await memoryClient.addMemory(big, tag, { sessionID: "ses-1", host: "claude-code" });
await memoryClient.addMemory(big, tag, { sessionID: "ses-1", host: "opencode" });
const tokensOf = () => config.CONFIG.retrievalMaxTokens;

const configPath = ${JSON.stringify(configPath)};
const rewriteTokens = (tokens) =>
  wf(configPath, JSON.stringify({
    storagePath: ${JSON.stringify(join(home, "store"))},
    embeddingDimensions: 4,
    userEmailOverride: "dev@example.com",
    injectProfile: false,
    retrievalMaxTokens: tokens,
  }));

let scenario;
${code}

await memoryClient.close();
console.log("RESULT:" + JSON.stringify(scenario ?? null));
`;
    const scriptPath = join(home, `scenario-${Date.now()}.mjs`);
    writeFileSync(scriptPath, script);
    const { exitCode, stdout, output } = await runBunProcess(["run", scriptPath], {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        OMMS_SKIP_LEGACY_MIGRATION: "1",
        OMMS_DISABLE_AUTO_BACKFILL: "1",
      },
    });
    if (exitCode !== 0) throw new Error(`scenario exited with code ${exitCode}: ${output}`);
    const match = stdout.match(/^RESULT:(.*)$/m);
    if (!match) throw new Error(`scenario produced no result: ${output}`);
    return JSON.parse(match[1]!);
  };

  return { home, projectDir, run };
}

describe("Claude Code shared budget and transport cap (memory-context-controls 4.1-4.3)", () => {
  it(
    "packs every hook section within the configured budget",
    async () => {
      const h = createHarness(300);
      const output = await h.run(`
const budget = tokensOf() * 4;
const prompt = await sectionOf({
  event: "user-prompt-submit", session_id: "ses-1", cwd: projectDir,
  prompt: "how should answers be formatted?",
});
const startup = await sectionOf({
  event: "session-start", session_id: "fresh-session", cwd: projectDir, source: "startup",
});
const restored = await sectionOf({
  event: "session-start", session_id: "ses-1", cwd: projectDir, source: "compact",
});
scenario = {
  budget,
  prompt: { bytes: byteLength(prompt), closed: closed(prompt), hasMemory: prompt.includes("short answers") },
  startup,
  restored: { bytes: byteLength(restored), closed: closed(restored), hasMemory: restored.includes("short answers") },
};
`);

      expect(output.prompt.closed).toBe(true);
      expect(output.prompt.hasMemory).toBe(true);
      expect(output.prompt.bytes).toBeLessThanOrEqual(output.budget);

      expect(output.startup).toBe("");

      expect(output.restored.closed).toBe(true);
      expect(output.restored.hasMemory).toBe(true);
      expect(output.restored.bytes).toBeLessThanOrEqual(output.budget);
    },
    TEST_PARENT_TIMEOUT_MS
  );

  it(
    "keeps the rows-off marker inside the budget and the transport cap",
    async () => {
      const small = createHarness(300, { visibleRecall: false });
      const output = await small.run(`
const marker = "<omms-retrieval>\\n<!--omms:rows-off-->\\n";
const prompt = await sectionOf({
  event: "user-prompt-submit", session_id: "ses-1", cwd: projectDir,
  prompt: "how should answers be formatted?",
});
const restored = await sectionOf({
  event: "session-start", session_id: "ses-1", cwd: projectDir, source: "compact",
});
scenario = {
  budget: tokensOf() * 4,
  prompt: { bytes: byteLength(prompt), closed: closed(prompt), marked: prompt.startsWith(marker), hasMemory: prompt.includes("short answers") },
  restored: { bytes: byteLength(restored), closed: closed(restored), marked: restored.startsWith(marker), hasMemory: restored.includes("short answers") },
};
`);
      for (const section of [output.prompt, output.restored]) {
        expect(section.marked).toBe(true);
        expect(section.closed).toBe(true);
        expect(section.hasMemory).toBe(true);
        expect(section.bytes).toBeLessThanOrEqual(output.budget);
      }

      const large = createHarness(65536, { visibleRecall: false });
      const cut = await large.run(`
const marker = "<omms-retrieval>\\n<!--omms:rows-off-->\\n";
const section = await sectionOf({
  event: "user-prompt-submit", session_id: "ses-1", cwd: projectDir,
  prompt: "how should answers be formatted?",
});
const transport = truncateContext(section);
scenario = {
  sectionBytes: byteLength(section),
  chars: transport.length,
  limit: CLAUDE_CONTEXT_LIMIT,
  marked: transport.startsWith(marker),
  closed: closed(transport),
};
`);
      expect(cut.sectionBytes).toBeGreaterThan(9500);
      expect(cut.chars).toBeLessThanOrEqual(cut.limit);
      expect(cut.marked).toBe(true);
      expect(cut.closed).toBe(true);
    },
    TEST_PARENT_TIMEOUT_MS
  );

  for (const rowsOff of [false, true]) {
    it(
      `keeps the prompt section and the opening section within one budget (rows ${rowsOff ? "off" : "on"})`,
      async () => {
        const h = createHarness(1000, {
          openingContext: true,
          openingContextQuery: "project setup",
          ...(rowsOff ? { visibleRecall: false } : {}),
        });
        const output = await h.run(`
const small = "Short prompt memory about formatting. ".repeat(4);
const rows = {
  "how should answers be formatted?": [{ id: "mem_prompt", similarity: 0.9, memory: small }],
  "project setup": [{ id: "mem_open", similarity: 0.8, memory: "Opening memory about setup. ".repeat(400) }],
};
memoryClient.searchMemories = async (query) => ({ success: true, results: rows[query] ?? [] });
const text = await sectionOf({
  event: "user-prompt-submit", session_id: "ses-1", cwd: projectDir,
  prompt: "how should answers be formatted?",
  transcript_path: ${JSON.stringify(join(h.home, ".claude", "projects", "-proj", "ses-1.jsonl"))},
});
scenario = {
  budget: tokensOf() * 4,
  bytes: byteLength(text),
  sections: text.split("<omms-retrieval>").length - 1,
  closed: closed(text),
  hasPrompt: text.includes("Short prompt memory"),
  hasOpening: text.includes("Opening memory about setup"),
  opening: text.includes("omms:opening"),
  rowsOff: text.split("<!--omms:rows-off-->").length - 1,
};
`);
        expect(output.sections).toBe(2);
        expect(output.closed).toBe(true);
        expect(output.hasPrompt).toBe(true);
        expect(output.hasOpening).toBe(true);
        expect(output.opening).toBe(!rowsOff);
        expect(output.rowsOff).toBe(rowsOff ? 2 : 0);
        expect(output.bytes).toBeLessThanOrEqual(output.budget);
      },
      TEST_PARENT_TIMEOUT_MS
    );
  }

  it(
    "applies a config edit to the next request",
    async () => {
      const h = createHarness(2000);
      const output = await h.run(`
const before = await sectionOf({
  event: "user-prompt-submit", session_id: "ses-1", cwd: projectDir,
  prompt: "how should answers be formatted?",
});
rewriteTokens(300);
const after = await sectionOf({
  event: "user-prompt-submit", session_id: "ses-1", cwd: projectDir,
  prompt: "how should answers be formatted?",
});
scenario = {
  beforeBytes: byteLength(before),
  afterBytes: byteLength(after),
  newBudget: 300 * 4,
  afterClosed: closed(after),
};
`);

      expect(output.beforeBytes).toBeLessThanOrEqual(2000 * 4);
      expect(output.afterBytes).toBeLessThanOrEqual(output.newBudget);
      expect(output.afterClosed).toBe(true);
    },
    TEST_PARENT_TIMEOUT_MS
  );

  it(
    "keeps the hook client transport cap with a closed wrapper above the budget",
    async () => {
      const h = createHarness(65536);
      const output = await h.run(`
const section = await sectionOf({
  event: "user-prompt-submit", session_id: "ses-1", cwd: projectDir,
  prompt: "how should answers be formatted?",
});
const transport = truncateContext(section);
scenario = {
  budget: tokensOf() * 4,
  sectionBytes: byteLength(section),
  sectionClosed: closed(section),
  transportChars: transport.length,
  limit: CLAUDE_CONTEXT_LIMIT,
  transportClosed: closed(transport),
};
`);

      // The shared budget allowed a large section...
      expect(output.sectionClosed).toBe(true);
      expect(output.sectionBytes).toBeGreaterThan(9500);
      // ...and the fixed transport cap still applies with the wrapper closed.
      expect(output.transportChars).toBeLessThanOrEqual(output.limit);
      expect(output.transportClosed).toBe(true);
    },
    TEST_PARENT_TIMEOUT_MS
  );
});
