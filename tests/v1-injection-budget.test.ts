import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Task 4.1/4.2 for OpenCode V1: the `chat.message` recent-memory injection and
// the `session.compacted` restore refresh the config, capture the byte budget
// before their async store reads, pack within it, keep the captured budget when
// the config changes mid-flight, and use the new budget on the next operation.
// The shared packing runs for real; the store and profile steps are stubbed.

const tempDirs: string[] = [];

const indexUrl = new URL("../src/index.js", import.meta.url).href;
const clientUrl = new URL("../src/services/client.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const privacyUrl = new URL("../src/services/privacy.js", import.meta.url).href;
const autoCaptureUrl = new URL("../src/services/auto-capture.js", import.meta.url).href;
const learningUrl = new URL("../src/adapters/opencode/profile-learning.js", import.meta.url).href;
const promptManagerUrl = new URL(
  "../src/services/user-prompt/user-prompt-manager.js",
  import.meta.url
).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;
const languageUrl = new URL("../src/services/language-detector.js", import.meta.url).href;

const BIG_MEMORY = "Prefer WAL mode for every new queue table ".repeat(20);
const BIG_MEMORIES = [BIG_MEMORY, BIG_MEMORY, BIG_MEMORY];

function runScenario(code: string): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-v1-budget-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

const state = { retrievalMaxTokens: 400, refreshes: 0 };
const reads = { list: [], session: [] };
// Runs while an injection's store read is in flight, before it resolves.
let mutateDuringRead = null;

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: {
    compaction: { enabled: true, memoryLimit: 10 },
    chatMessage: {
      enabled: true,
      maxMemories: 3,
      excludeCurrentSession: true,
      maxAgeDays: 0,
      injectOn: "first",
    },
    autoCaptureEnabled: false,
    get retrievalMaxTokens() {
      return state.retrievalMaxTokens;
    },
  },
  initConfig: () => {},
  initConfigWithLegacyMigration: () => {},
  refreshConfigIfChanged: () => {
    state.refreshes++;
  },
  getExplicitContainerTagPrefix: () => undefined,
  isConfigured: () => true,
}));

mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    warmup: async () => {},
    isReady: async () => true,
    listMemories: async (_tag, limit) => {
      reads.list.push({ refreshes: state.refreshes, tokens: state.retrievalMaxTokens, limit });
      if (mutateDuringRead) mutateDuringRead();
      return {
        success: true,
        memories: ${JSON.stringify(
          Array.from({ length: 3 }, (_, i) => ({
            summary: BIG_MEMORY,
            createdAt: new Date(Date.now() - i).toISOString(),
            metadata: { sessionID: "older-session" },
          }))
        )},
      };
    },
    searchMemoriesBySessionID: async () => {
      reads.session.push({ refreshes: state.refreshes, tokens: state.retrievalMaxTokens });
      if (mutateDuringRead) mutateDuringRead();
      return { success: true, results: ${JSON.stringify(
        BIG_MEMORIES.map((memory, i) => ({
          memory,
          tags: ["queue"],
          metadata: { sessionID: "ses-1", host: "opencode" },
          createdAt: new Date(Date.now() - i).toISOString(),
        }))
      )}, total: 3 };
    },
    close() {},
  },
}));

mock.module(${JSON.stringify(tagsUrl)}, () => ({
  getTags: () => ({
    project: { tag: "project-tag" },
    user: { userEmail: "u@example.com" },
  }),
}));
mock.module(${JSON.stringify(privacyUrl)}, () => ({
  stripPrivateContent: (value) => value,
  isFullyPrivate: () => false,
}));
mock.module(${JSON.stringify(autoCaptureUrl)}, () => ({ performAutoCapture: async () => {} }));
mock.module(${JSON.stringify(learningUrl)}, () => ({ performUserProfileLearning: async () => {} }));
mock.module(${JSON.stringify(promptManagerUrl)}, () => ({ userPromptManager: { savePrompt() {} } }));
mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));
mock.module(${JSON.stringify(languageUrl)}, () => ({ getLanguageName: () => "English" }));

const promptCalls = [];
const mockClient = {
  session: {
    get: async () => ({ data: { agent: "build" } }),
    // No earlier user messages, so chat.message injects on the first message.
    messages: async () => ({ data: [] }),
    prompt: async (args) => {
      promptCalls.push(args);
      return {};
    },
  },
  tui: { showToast: async () => ({}) },
};

const { OmmsPlugin } = await import(${JSON.stringify(indexUrl)});
const plugin = await OmmsPlugin({ directory: "/workspace", client: mockClient });

const byteLength = (text) => Buffer.byteLength(text, "utf8");

async function chatMessage(sessionId, messageId) {
  const output = {
    parts: [{ type: "text", text: "Fix the login timeout" }],
    message: { id: messageId },
  };
  await plugin["chat.message"]({ sessionID: sessionId }, output);
  return output.parts[0].type === "text" && output.parts[0].text !== "Fix the login timeout"
    ? output.parts[0].text
    : null;
}

async function compacted(sessionId) {
  await plugin.event({
    event: { type: "session.compacted", properties: { sessionID: sessionId } },
  });
  const call = promptCalls[promptCalls.length - 1];
  return call ? call.body.parts[0].text : null;
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

describe("OpenCode V1 injection budget (memory-context-controls 4.1/4.2)", () => {
  it("refreshes config, then injects recent memories within the captured budget", () => {
    const output = runScenario(`
const section = await chatMessage("ses-1", "msg-1");
scenario = {
  refreshedBeforeRead: reads.list[0]?.refreshes,
  countSnapshot: reads.list[0]?.limit,
  bytes: section ? byteLength(section) : 0,
  budgetBytes: 400 * 4,
  hasMemory: Boolean(section && section.includes("WAL mode")),
};
`);

    expect(output.refreshedBeforeRead).toBeGreaterThan(0);
    // The count snapshot passed through unchanged.
    expect(output.countSnapshot).toBe(3);
    expect(output.bytes).toBeLessThanOrEqual(output.budgetBytes);
    expect(output.bytes).toBeGreaterThan(150 * 4);
    expect(output.hasMemory).toBe(true);
  });

  it("keeps the captured budget when the config changes during the store read", () => {
    const output = runScenario(`
mutateDuringRead = () => {
  state.retrievalMaxTokens = 150;
};
const first = await chatMessage("ses-1", "msg-1");
const firstBytes = first ? byteLength(first) : 0;
mutateDuringRead = null;
const second = await chatMessage("ses-1", "msg-2");
const secondBytes = second ? byteLength(second) : 0;
scenario = {
  readSawTokens: reads.list[0]?.tokens,
  firstBytes,
  newBudgetBytes: 150 * 4,
  secondBytes,
};
`);

    // The read ran while the old value was still configured.
    expect(output.readSawTokens).toBe(400);
    // The in-flight injection kept the captured 1,600-byte allowance.
    expect(output.firstBytes).toBeLessThanOrEqual(400 * 4);
    expect(output.firstBytes).toBeGreaterThan(150 * 4);
    // The next injection uses the new, smaller budget.
    expect(output.secondBytes).toBeLessThanOrEqual(output.newBudgetBytes);
  });

  it("packs the compaction restore within the captured budget", () => {
    const output = runScenario(`
const section = await compacted("ses-1");
scenario = {
  refreshedBeforeRead: reads.session[0]?.refreshes,
  bytes: section ? byteLength(section) : 0,
  budgetBytes: 400 * 4,
  hasMemory: Boolean(section && section.includes("WAL mode")),
};
`);

    expect(output.refreshedBeforeRead).toBeGreaterThan(0);
    expect(output.bytes).toBeLessThanOrEqual(output.budgetBytes);
    expect(output.bytes).toBeGreaterThan(150 * 4);
    expect(output.hasMemory).toBe(true);
  });

  it("keeps the restore's captured budget when the config changes during the read", () => {
    const output = runScenario(`
mutateDuringRead = () => {
  state.retrievalMaxTokens = 150;
};
const section = await compacted("ses-1");
scenario = {
  readSawTokens: reads.session[0]?.tokens,
  bytes: section ? byteLength(section) : 0,
};
`);

    expect(output.readSawTokens).toBe(400);
    expect(output.bytes).toBeLessThanOrEqual(400 * 4);
    expect(output.bytes).toBeGreaterThan(150 * 4);
  });
});
