import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Skill-turn recording at the OpenCode and Pi live capture sites (task 3.4).
 * Each scenario runs in its own process: the config, memory client, tags,
 * prompt store and logger are stubbed, and `skills.db` is a real file in a
 * temporary storage folder.
 */

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const url = (path: string) => JSON.stringify(new URL(`../src/${path}`, import.meta.url).href);

interface Scenario {
  config?: Record<string, unknown>;
  /** "capture", "skip", or "fail" for every summarize call. */
  mode?: string;
  /** Make `skills.db` a folder, so the store cannot be opened. */
  brokenStore?: boolean;
  code: string;
}

function run(scenario: Scenario): any {
  const dir = mkdtempSync(join(tmpdir(), "omms-skill-live-"));
  tempDirs.push(dir);
  const storage = join(dir, "store");
  const script = `
import { mock } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const storage = ${JSON.stringify(storage)};
mkdirSync(${JSON.stringify(scenario.brokenStore ? join(storage, "skills.db") : storage)}, { recursive: true });
const CONFIG = {
  storagePath: storage,
  autoCaptureEnabled: true,
  autoCaptureMaxRetries: 1,
  autoCaptureMaxContextBytes: 131072,
  autoCaptureProviderStatus: { ready: true, mode: "opencode", issues: [] },
  showAutoCaptureToasts: false,
  showErrorToasts: false,
  skillLearning: true,
  skillLearningRedact: true,
  skillFolders: [],
  ...${JSON.stringify(scenario.config ?? {})},
};
mock.module(${url("config.js")}, () => ({ refreshConfigIfChanged: () => {}, CONFIG }));

const addCalls = [];
mock.module(${url("services/client.js")}, () => ({
  memoryClient: {
    listMemories: async () => ({ success: true, memories: [] }),
    addMemory: async (content, _tag, metadata) => {
      addCalls.push({ content, promptId: metadata.promptId });
      return { success: true, id: "mem-" + addCalls.length };
    },
    getEmbeddingInitError: () => null,
    close() {},
  },
}));
mock.module(${url("services/tags.js")}, () => ({
  getTags: () => ({ project: { tag: "p_test", displayName: "Test", projectName: "workspace" } }),
}));
const logs = [];
mock.module(${url("services/logger.js")}, () => ({
  log: (message, data) => logs.push({ message, data: data ?? null }),
}));
mock.module(${url("services/capture-retry-drain.js")}, () => ({
  queueFailedCapture: async () => true,
  startCaptureRetryDrain: () => {},
  drainCaptureRetries: async () => ({}),
}));

const prompts = [
  { id: "prompt-1", sessionId: "session-1", messageId: "msg-1", content: "Search the web", createdAt: 1, captured: false, claimed: false, capture_attempts: 0 },
];
mock.module(${url("services/user-prompt/user-prompt-manager.js")}, () => ({
  userPromptManager: {
    getUncapturedPromptsForSession: (id) => prompts.filter((p) => p.sessionId === id && !p.captured && !p.claimed),
    claimPrompt: (id) => { const p = prompts.find((x) => x.id === id); if (!p || p.claimed || p.captured) return false; p.claimed = true; return true; },
    recordFailedAttempt: (id) => { prompts.find((x) => x.id === id).capture_attempts++; },
    releaseClaim: (id) => { prompts.find((x) => x.id === id).claimed = false; return true; },
    linkMemoryToPrompt: () => {},
    markAsCaptured: (id) => { const p = prompts.find((x) => x.id === id); p.captured = true; p.claimed = false; },
    deletePrompt: (id) => { const p = prompts.find((x) => x.id === id); p.captured = true; p.claimed = false; },
  },
}));

let mode = ${JSON.stringify(scenario.mode ?? "capture")};
const contexts = [];
const provider = {
  summarize: async ({ context }) => {
    contexts.push(context);
    if (mode === "fail") throw new Error("model unavailable");
    if (mode === "skip") return { summary: "", type: "skip", tags: [] };
    return { summary: "summary " + contexts.length, type: "discussion", tags: [] };
  },
};
const conversation = {
  textResponses: ["Found three pages"],
  toolCalls: [{ name: "Bash", input: 'command: "false"', outcome: "error", error: "exit 1" }],
  sourceEntryIds: ["msg-2"],
};
const opencodeHost = {
  host: "opencode",
  isCaptureReady: () => true,
  getConversation: async () => conversation,
  ...provider,
  notify: async () => {},
};

const { tursoConnectionManager } = await import(${url("services/turso/connection-manager.js")});
async function turns() {
  const db = await tursoConnectionManager.getConnection(join(storage, "skills.db"));
  const rows = await db.all("SELECT turn_key, prompt FROM turns ORDER BY id");
  const calls = await db.all("SELECT name, outcome, error FROM tool_calls ORDER BY id");
  return { rows: rows.map((r) => ({ ...r })), calls: calls.map((c) => ({ ...c })) };
}
const { existsSync } = await import("node:fs");
const hasStore = () => existsSync(join(storage, "skills.db"));

let result;
${scenario.code}
console.log("RESULT:" + JSON.stringify({ result: result ?? null, addCalls, contexts, logs }));
`;
  const scriptPath = join(dir, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: dir });
  const stdout = proc.stdout.toString();
  const match = stdout.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(`scenario produced no result: ${stdout}\n${proc.stderr.toString()}`);
  return JSON.parse(match[1]!);
}

const OPENCODE = `
const { performAutoCapture } = await import(${url("services/auto-capture.js")});
await performAutoCapture(opencodeHost, "session-1", "/workspace");
`;

const PI = `
const { capturePiSettledWorkUnit, createPiCaptureState } = await import(${url("adapters/pi/capture.js")});
const piEntries = [
  { type: "message", id: "u-1", parentId: null, timestamp: "2026-01-01T10:00:00.000Z", message: { role: "user", content: "Search the web" } },
  { type: "message", id: "a-1", parentId: "u-1", timestamp: "2026-01-01T10:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "Found three pages" }] } },
];
const piState = createPiCaptureState();
const settle = () => capturePiSettledWorkUnit({ sessionId: "pi-1", directory: "/workspace", entries: piEntries, provider, state: piState });
`;

const failedRecords = (logs: Array<{ data: any }>) =>
  logs.filter((entry) => entry.data?.code === "skill-record-failed");

describe("OpenCode live site", () => {
  it("sends the same memory request with skills on and off, and records the turn", () => {
    const code = `${OPENCODE}\nresult = hasStore() ? await turns() : null;`;
    const on = run({ code });
    const off = run({ config: { skillLearning: false }, code });
    expect(on.contexts).toEqual(off.contexts);
    expect(on.addCalls).toEqual(off.addCalls);
    expect(off.result).toBeNull();
    // The key uses OpenCode's message id, as the history import does.
    expect(on.result.rows).toEqual([
      { turn_key: "opencode:session-1:msg-1", prompt: "Search the web" },
    ]);
    expect(on.result.calls).toEqual([{ name: "Bash", outcome: "error", error: "exit 1" }]);
  });

  it("records a turn the memory extractor skips", () => {
    const out = run({ mode: "skip", code: `${OPENCODE}\nresult = await turns();` });
    expect(out.addCalls).toHaveLength(0);
    expect(out.result.rows).toHaveLength(1);
  });

  it("logs skill-record-failed and still saves the memory when the store cannot open", () => {
    const out = run({ brokenStore: true, code: OPENCODE });
    expect(out.addCalls).toHaveLength(1);
    expect(failedRecords(out.logs)).toHaveLength(1);
  });

  it("keeps one row when a failed capture is tried again", () => {
    const out = run({
      mode: "fail",
      code: `${OPENCODE}\nmode = "capture";\nprompts[0].capture_attempts = 0;\nawait performAutoCapture(opencodeHost, "session-1", "/workspace");\nresult = await turns();`,
    });
    expect(out.contexts).toHaveLength(2);
    expect(out.addCalls).toHaveLength(1);
    expect(out.result.rows).toHaveLength(1);
  });

  it("records turns when the capture model is not ready or capture is off", () => {
    const notReady = run({
      code: `opencodeHost.isCaptureReady = () => false;\n${OPENCODE}\nresult = await turns();`,
    });
    expect(notReady.contexts).toHaveLength(0);
    expect(notReady.result.rows).toHaveLength(1);
    const off = run({
      config: { autoCaptureEnabled: false },
      code: `${OPENCODE}\nresult = await turns();`,
    });
    expect(off.contexts).toHaveLength(0);
    expect(off.result.rows).toHaveLength(1);
  });

  it("reads each prompt once over several idle events while capture is off", () => {
    const out = run({
      config: { autoCaptureEnabled: false },
      code: `
const prompt = (n) => ({ id: "prompt-" + n, sessionId: "session-1", messageId: "msg-" + n, content: "Request " + n, createdAt: n, captured: false, claimed: false, capture_attempts: 0 });
prompts[0].createdAt = 1;
prompts.push(prompt(2));
const reads = [];
const read = opencodeHost.getConversation;
opencodeHost.getConversation = async (session, messageId) => { reads.push(messageId); return read(session, messageId); };
const { performAutoCapture } = await import(${url("services/auto-capture.js")});
await performAutoCapture(opencodeHost, "session-1", "/workspace");
prompts.push(prompt(3));
await performAutoCapture(opencodeHost, "session-1", "/workspace");
await performAutoCapture(opencodeHost, "session-1", "/workspace");
const whileOff = { reads: [...reads], captured: prompts.map((p) => p.captured), rows: (await turns()).rows.length };
CONFIG.autoCaptureEnabled = true;
await performAutoCapture(opencodeHost, "session-1", "/workspace");
result = { whileOff, captured: prompts.map((p) => p.captured) };`,
    });
    expect(out.result.whileOff).toEqual({
      reads: ["msg-1", "msg-2", "msg-3"],
      captured: [false, false, false],
      rows: 3,
    });
    // Memory capture still sees every prompt once it is turned on.
    expect(out.addCalls).toHaveLength(3);
    expect(out.result.captured).toEqual([true, true, true]);
  });

  it("keeps one row for a turn recorded live and then read by the history import", () => {
    const out = run({
      code: `${OPENCODE}
const { DatabaseSync } = await import("node:sqlite");
const historyPath = join(storage, "..", "opencode.db");
const db = new DatabaseSync(historyPath);
db.exec(\`CREATE TABLE project (id TEXT, worktree TEXT);
  CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER);
  CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
  CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);\`);
db.prepare("INSERT INTO project VALUES (?, ?)").run("p", "/workspace");
db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("session-1", "p", null, "/workspace", 1);
db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg-1", "session-1", 10, JSON.stringify({ role: "user" }));
db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("p1", "msg-1", "session-1", 10, JSON.stringify({ type: "text", text: "Search the web" }));
db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg-2", "session-1", 11, JSON.stringify({ role: "assistant" }));
db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("p2", "msg-2", "session-1", 11, JSON.stringify({ type: "text", text: "Found three pages" }));
db.close();
const { openOpencodeHistory } = await import(${url("importer/opencode-reader.js")});
const history = await openOpencodeHistory(historyPath, {});
const [window] = history.loadUnits("session-1");
await history.close();
const { skillTurnRecorder } = await import(${url("services/skill-learning/settings-for.js")});
const status = await skillTurnRecorder("/workspace")({
  host: "opencode", hostSessionId: "session-1", sourceType: "history-import", projectDirectory: "/workspace",
  userPrompt: window.userPrompt, promptId: window.userEntryId, textResponses: window.textResponses, toolCalls: window.toolCalls,
});
result = { status, ...(await turns()) };`,
    });
    expect(out.result.status).toBe("duplicate");
    expect(out.result.rows).toHaveLength(1);
  });
});

describe("Pi live site", () => {
  it("sends the same memory request with skills on and off, and records the turn", () => {
    const code = `${PI}\nawait settle();\nresult = hasStore() ? await turns() : null;`;
    const on = run({ code });
    const off = run({ config: { skillLearning: false }, code });
    expect(on.contexts).toEqual(off.contexts);
    expect(on.addCalls).toEqual(off.addCalls);
    expect(off.result).toBeNull();
    expect(on.result.rows).toEqual([{ turn_key: "pi:pi-1:u-1", prompt: "Search the web" }]);
  });

  it("records a turn the memory extractor skips", () => {
    const out = run({ mode: "skip", code: `${PI}\nawait settle();\nresult = await turns();` });
    expect(out.addCalls).toHaveLength(0);
    expect(out.result.rows).toHaveLength(1);
  });

  it("logs skill-record-failed and still saves the memory when the store cannot open", () => {
    const out = run({ brokenStore: true, code: `${PI}\nresult = await settle();` });
    expect(out.result.status).toBe("captured");
    expect(failedRecords(out.logs)).toHaveLength(1);
  });

  it("keeps one row when a failed capture is tried again", () => {
    const out = run({
      mode: "fail",
      code: `${PI}\nawait settle();\nmode = "capture";\nconst again = await settle();\nresult = { again, ...(await turns()) };`,
    });
    expect(out.result.again.status).toBe("captured");
    expect(out.result.rows).toHaveLength(1);
  });

  it("records turns when capture is off or embeddings are not ready", () => {
    const off = run({
      config: { autoCaptureEnabled: false },
      code: `${PI}\nconst status = await settle();\nresult = { status, ...(await turns()) };`,
    });
    expect(off.result.status).toEqual({ status: "skipped", reason: "disabled" });
    expect(off.contexts).toHaveLength(0);
    expect(off.result.rows).toHaveLength(1);
    const notReady = run({
      code: `${PI}\nconst { memoryClient } = await import(${url("services/client.js")});\nmemoryClient.getEmbeddingInitError = () => "no model";\nconst status = await settle();\nresult = { status, ...(await turns()) };`,
    });
    expect(notReady.result.status).toEqual({ status: "skipped", reason: "not-ready" });
    expect(notReady.result.rows).toHaveLength(1);
  });
});
