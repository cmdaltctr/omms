import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pi expands `/skill:<name> text` into a `<skill ...>` wrapper before the
// agent starts. The automatic recall must search with the user's own words, not
// the skill markup. The shared retrieval runs for real; only the store, tags
// and profile lookups are stubbed.

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
  const dir = mkdtempSync(join(tmpdir(), "omms-pi-skill-query-"));
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

const stubConfig = {
    openingContext: false,
    openingContextQuery: "project setup",
    compaction: { enabled: true, memoryLimit: 10 },
    subagentMemory: true,
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
};
mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: stubConfig,
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
    searchMemoriesBySessionID: async () => ({
      success: true,
      results: [1, 2, 3].map((n) => ({ id: "res-" + n, memory: ("Restored memory " + n + " ").repeat(40), tags: [], metadata: { host: "pi" } })),
    }),
    searchMemories: async (query) => {
      searches.push({ query, refreshes: state.refreshes, tokens: state.retrievalMaxTokens });
      if (mutateDuringSearch) mutateDuringSearch();
      if (query === "project setup") {
        return {
          success: true,
          results: [1, 2, 3].map((n) => ({ id: "open-" + n, memory: ("Opening memory " + n + " ").repeat(40), similarity: 0.9, metadata: { sessionID: "other" } })),
        };
      }
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

const SKILL_BLOCK =
  '<skill name="omms-remember" location="/skills/omms-remember/SKILL.md">\\nReferences are relative to /skills/omms-remember.\\n\\nSave a snapshot of the session.\\n</skill>';

async function recall(prompt) {
  await handlers["before_agent_start"]({ prompt, systemPrompt: "BASE" }, ctx);
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

describe("Pi recall query with a skill wrapper", () => {
  it("searches with the text after the skill block", () => {
    const output = runScenario(`
await recall(SKILL_BLOCK + "\\n\\nsave the retry queue decision");
scenario = { queries: searches.map((s) => s.query) };
`);

    expect(output.queries).toEqual(["save the retry queue decision"]);
  });

  it("runs no prompt search when only the skill block is sent", () => {
    const output = runScenario(`
await recall(SKILL_BLOCK);
scenario = { queries: searches.map((s) => s.query) };
`);

    expect(output.queries).toEqual([]);
  });

  it("leaves a plain prompt unchanged", () => {
    const output = runScenario(`
await recall("how does the retry queue work?");
scenario = { queries: searches.map((s) => s.query) };
`);

    expect(output.queries).toEqual(["how does the retry queue work?"]);
  });
});
