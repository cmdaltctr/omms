import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Task 4.1/4.2 for Pi: `before_agent_start` refreshes the config, captures the
// byte budget before the async retrieval starts, packs the wrapped section
// within it, keeps the captured budget when the config changes mid-flight, and
// uses the new budget on the next prompt. The shared packing runs for real;
// only the store, tags, and profile lookups are stubbed.

const tempDirs: string[] = [];

const extensionUrl = new URL("../src/adapters/pi/extension.js", import.meta.url).href;
const backfillUrl = new URL("../src/importer/auto-backfill.js", import.meta.url).href;
const autostartUrl = new URL("../src/services/web-autostart.js", import.meta.url).href;
const ensureUrl = new URL("../src/services/web-ensure.js", import.meta.url).href;
const handoffUrl = new URL("../src/services/runtime-handoff.js", import.meta.url).href;
const clientUrl = new URL("../src/services/client.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;
const languageUrl = new URL("../src/services/language-detector.js", import.meta.url).href;
const profileContextUrl = new URL(
  "../src/services/user-profile/profile-context.js",
  import.meta.url
).href;
const profileManagerUrl = new URL(
  "../src/services/user-profile/user-profile-manager.js",
  import.meta.url
).href;

function runScenario(code: string): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-pi-budget-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const handlers = {};
const statusCalls = [];

const state = { retrievalMaxTokens: 400, refreshes: 0 };
const searches = [];
// Runs while the retrieval's search is in flight, before it resolves.
let mutateDuringSearch = null;

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: {
    autoCaptureEnabled: false,
    autoCaptureLanguage: "en",
    chatMessage: { enabled: true, excludeCurrentSession: true },
    showAutoCaptureToasts: false,
    showUserProfileToasts: false,
    showErrorToasts: false,
    memory: { defaultScope: "project" },
    injectProfile: false,
    userProfileAnalysisInterval: 1,
    get retrievalMaxTokens() {
      return state.retrievalMaxTokens;
    },
  },
  isConfigured: () => true,
  initConfig: () => {},
  initConfigWithLegacyMigration: () => {},
  refreshConfigIfChanged: () => {
    state.refreshes++;
  },
}));

mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    warmup: async () => {},
    getEmbeddingInitError: () => undefined,
    searchMemories: async (query) => {
      searches.push({ query, refreshes: state.refreshes, tokens: state.retrievalMaxTokens });
      if (mutateDuringSearch) mutateDuringSearch();
      return {
        success: true,
        results: [
          { id: "mem-1", memory: "First memory ".repeat(40), similarity: 0.9, metadata: { sessionID: "other" } },
          { id: "mem-2", memory: "Second memory ".repeat(40), similarity: 0.8, metadata: { sessionID: "other" } },
          { id: "mem-3", memory: "Third memory ".repeat(40), similarity: 0.7, metadata: { sessionID: "other" } },
        ],
      };
    },
  },
}));

mock.module(${JSON.stringify(tagsUrl)}, () => ({
  getTags: () => ({
    project: { tag: "omms_project_x" },
    user: { tag: "user", displayName: "Dev", userName: "dev", userEmail: "dev@example.com" },
  }),
}));

const logCalls = [];
mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: (message) => logCalls.push(message) }));
mock.module(${JSON.stringify(autostartUrl)}, () => ({ reconcileWebAutostart: () => {} }));
mock.module(${JSON.stringify(handoffUrl)}, () => ({
  registerOwnCopy: () => "written",
  hostReplaceOlder: async () => ({ version: "4.3.2", headers: {} }),
}));
mock.module(${JSON.stringify(ensureUrl)}, () => ({
  ensureWebApp: () => new Promise(() => {}),
}));
mock.module(${JSON.stringify(backfillUrl)}, () => ({
  scheduleAutoBackfill: async () => {},
}));
mock.module(${JSON.stringify(languageUrl)}, () => ({
  detectLanguage: () => "en",
  getLanguageName: () => "English",
}));
mock.module(${JSON.stringify(profileContextUrl)}, () => ({
  getUserProfileContext: async () => null,
}));
mock.module(${JSON.stringify(profileManagerUrl)}, () => ({
  userProfileManager: { getActiveProfile: async () => null },
}));

const { default: ommsPiExtension } = await import(${JSON.stringify(extensionUrl)});

const ctx = {
  cwd: "/workspace",
  hasUI: true,
  mode: "tui",
  ui: { notify: () => {}, setStatus: (key, value) => statusCalls.push([key, value ?? null]) },
  sessionManager: { getSessionId: () => "pi-session-1", getBranch: () => [] },
  model: null,
  modelRegistry: null,
};

const pi = {
  on: (event, handler) => {
    handlers[event] = handler;
  },
  registerTool: () => {},
  registerCommand: () => {},
};
ommsPiExtension(pi);

const byteLength = (text) => Buffer.byteLength(text, "utf8");

async function recall(handlers, ctx) {
  const reply = await handlers["before_agent_start"](
    { prompt: "how does the retry queue work?", systemPrompt: "BASE" },
    ctx
  );
  return reply?.systemPrompt ?? null;
}

let scenario;
${code}

console.log("RESULT:" + JSON.stringify(scenario ?? null));
`;

  writeFileSync(scriptPath, script, "utf8");
  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5_000,
  });
  const stdout = Buffer.from(result.stdout).toString("utf8");
  const stderr = Buffer.from(result.stderr).toString("utf8");
  const match = stdout.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(`scenario produced no result: ${stdout}\n${stderr}`);
  return JSON.parse(match[1]!);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Pi before_agent_start budget (memory-context-controls 4.1/4.2)", () => {
  it("refreshes config, then packs the wrapped section within the captured budget", () => {
    const output = runScenario(`
const before = state.refreshes;
const systemPrompt = await recall(handlers, ctx);
const section = systemPrompt.slice("BASE".length + 2);
scenario = {
  refreshesBeforeSearch: searches[0]?.refreshes,
  refreshesIncreased: state.refreshes > before,
  sectionBytes: byteLength(section),
  budgetBytes: 400 * 4,
  closed: section.startsWith("<omms-retrieval>") && section.endsWith("</omms-retrieval>"),
  hasMemory: section.includes("First memory"),
};
`);

    expect(output.refreshesIncreased).toBe(true);
    // The refresh happened before the search started.
    expect(output.refreshesBeforeSearch).toBeGreaterThan(0);
    expect(output.sectionBytes).toBeLessThanOrEqual(output.budgetBytes);
    expect(output.closed).toBe(true);
    expect(output.hasMemory).toBe(true);
  });

  it("keeps the captured budget when the config changes during the search", () => {
    const output = runScenario(`
mutateDuringSearch = () => {
  state.retrievalMaxTokens = 150;
};
const systemPrompt = await recall(handlers, ctx);
const section = systemPrompt.slice("BASE".length + 2);
const firstBytes = byteLength(section);
mutateDuringSearch = null;
const second = await recall(handlers, ctx);
// A null section means nothing fit the new, smaller allowance.
const secondSection = second ? second.slice("BASE".length + 2) : null;
scenario = {
  searchSawTokens: searches[0]?.tokens,
  firstBytes,
  newBudgetBytes: 150 * 4,
  secondBytes: secondSection ? byteLength(secondSection) : 0,
  secondClosed: !secondSection ||
    (secondSection.startsWith("<omms-retrieval>") && secondSection.endsWith("</omms-retrieval>")),
};
`);

    // The search ran while the old value was still configured.
    expect(output.searchSawTokens).toBe(400);
    // The in-flight request kept the captured 1,600-byte allowance.
    expect(output.firstBytes).toBeLessThanOrEqual(400 * 4);
    expect(output.firstBytes).toBeGreaterThan(150 * 4);
    // The next request uses the new, smaller budget.
    expect(output.secondBytes).toBeLessThanOrEqual(output.newBudgetBytes);
    expect(output.secondClosed).toBe(true);
  });
});
