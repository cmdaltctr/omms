import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The web app's Claude Code hook handlers: retrieval for `SessionStart` and
 * `UserPromptSubmit`, and the capture worker for `Stop`. Each scenario runs in
 * its own process with a temporary HOME and store. Only embeddings, the
 * storage ready gate, and the logger are stubbed; the capture model is a stub
 * `CaptureSummaryProvider` passed to the handler.
 */

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const moduleUrl = (path: string) => pathToFileURL(join(import.meta.dir, "..", path)).href;

interface Harness {
  home: string;
  projectDir: string;
  otherProjectDir: string;
  run: (code: string) => Promise<any>;
}

const EXTERNAL_API = {
  memoryModel: "test-model",
  memoryApiUrl: "https://api.invalid/v1",
  memoryApiKey: "test-key-value",
};

function createHarness(config: Record<string, unknown> = EXTERNAL_API): Harness {
  const home = mkdtempSync(join(tmpdir(), "omms-claude-hook-home-"));
  const projectDir = mkdtempSync(join(tmpdir(), "omms-claude-hook-project-"));
  const otherProjectDir = mkdtempSync(join(tmpdir(), "omms-claude-hook-other-"));
  tempDirs.push(home, projectDir, otherProjectDir);
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  writeFileSync(
    join(home, ".config", "omms", "omms.jsonc"),
    JSON.stringify({
      storagePath: join(home, "store"),
      embeddingDimensions: 4,
      userEmailOverride: "dev@example.com",
      autoCaptureMaxRetries: 1,
      userProfileAnalysisInterval: 0,
      injectProfile: false,
      ...config,
    })
  );

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

const { writeFileSync, appendFileSync, mkdirSync, symlinkSync } = await import("node:fs");
const { join } = await import("node:path");
const config = await import(${JSON.stringify(moduleUrl("src/config.js"))});
const projectDir = ${JSON.stringify(projectDir)};
const otherProjectDir = ${JSON.stringify(otherProjectDir)};
config.initConfig(projectDir);
const { memoryClient } = await import(${JSON.stringify(moduleUrl("src/services/client.js"))});
const { getTags } = await import(${JSON.stringify(moduleUrl("src/services/tags.js"))});
const { countCaptureRetries } = await import(${JSON.stringify(moduleUrl("src/services/capture-retry-queue.js"))});
const api = await import(${JSON.stringify(moduleUrl("src/importer/claude-hook-api.js"))});

const calls = [];
let failWith = null;
const provider = {
  async summarize(request) {
    calls.push({ userPrompt: request.userPrompt, context: request.context });
    if (failWith) throw failWith;
    return { summary: "Summary " + calls.length, type: "feature", tags: [] };
  },
};

let line = 0;
// Claude Code writes <projects root>/<folder>/<session_id>.jsonl.
const projectsRoot = join(${JSON.stringify(home)}, ".claude", "projects");
const transcriptDir = join(projectsRoot, "-proj");
mkdirSync(transcriptDir, { recursive: true });
const transcript = join(transcriptDir, "ses-1.jsonl");
writeFileSync(transcript, "");
function entry(type, uuid, content, extra = {}) {
  line++;
  return JSON.stringify({
    type, uuid, parentUuid: null, isSidechain: false,
    timestamp: new Date(Date.UTC(2026, 8, 29, 10, 0, line)).toISOString(),
    cwd: projectDir, sessionId: "ses-1",
    message: { role: type, content },
    ...extra,
  }) + "\\n";
}
function turn(id, prompt, reply) {
  appendFileSync(transcript, entry("user", "u-" + id, prompt));
  if (reply !== null) {
    appendFileSync(transcript, entry("assistant", "a-" + id, [{ type: "text", text: reply }]));
  }
}
async function capture(extra = {}) {
  const reply = api.handleClaudeCapture(
    { session_id: "ses-1", transcript_path: transcript, cwd: projectDir, ...extra },
    { captureProvider: () => provider }
  );
  await api.whenClaudeCaptureIdle();
  return reply;
}
async function stored() {
  const listed = await memoryClient.listMemories(getTags(projectDir).project.tag, 50);
  return listed.memories.map((m) => ({ summary: m.summary, metadata: m.metadata }));
}

let scenario;
${code}

await memoryClient.close();
console.log("RESULT:" + JSON.stringify(scenario ?? null));
`;
    const scriptPath = join(home, `scenario-${Date.now()}.mjs`);
    writeFileSync(scriptPath, script);
    const proc = Bun.spawn(["bun", "run", scriptPath], {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        OMMS_SKIP_LEGACY_MIGRATION: "1",
        OMMS_DISABLE_AUTO_BACKFILL: "",
      },
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const match = stdout.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`scenario produced no result: ${stdout}\n${stderr}`);
    return JSON.parse(match[1]!);
  };

  return { home, projectDir, otherProjectDir, run };
}

const SEED_MEMORIES = `
const tag = getTags(projectDir).project.tag;
const otherTag = getTags(otherProjectDir).project.tag;
await memoryClient.addMemory("Old project decision about libSQL", tag, { sessionID: "ses-old", host: "opencode" });
await memoryClient.addMemory("Claude session memory about the parser", tag, { sessionID: "ses-1", host: "claude-code" });
await memoryClient.addMemory("OpenCode memory that shares the id", tag, { sessionID: "ses-1", host: "opencode" });
await memoryClient.addMemory("Other project memory for the same session", otherTag, { sessionID: "ses-1", host: "claude-code" });
`;

describe("Claude Code retrieval", () => {
  it("returns the project's recent memories at startup, wrapped in the retrieval tag", async () => {
    const { run } = createHarness();
    const scenario = await run(`
${SEED_MEMORIES}
const startup = await api.handleClaudeRetrieve({ event: "session-start", session_id: "ses-new", cwd: projectDir, source: "startup" });
const empty = await api.handleClaudeRetrieve({ event: "session-start", session_id: "ses-new", cwd: join(projectDir, "..", "no-memories-here"), source: "startup" });
scenario = { startup: startup.additionalContext, empty: empty.additionalContext };
`);
    expect(scenario.startup.startsWith("<omms-retrieval>")).toBe(true);
    expect(scenario.startup.trimEnd().endsWith("</omms-retrieval>")).toBe(true);
    expect(scenario.startup).toContain("Old project decision about libSQL");
    expect(scenario.startup).not.toContain("Other project memory");
    expect(scenario.empty).toBe("");
  });

  it("returns only that session's Claude Code memories after compaction", async () => {
    const { run } = createHarness();
    const scenario = await run(`
${SEED_MEMORIES}
const compact = await api.handleClaudeRetrieve({ event: "session-start", session_id: "ses-1", cwd: projectDir, source: "compact" });
const resume = await api.handleClaudeRetrieve({ event: "session-start", session_id: "ses-1", cwd: projectDir, source: "resume" });
scenario = { compact: compact.additionalContext, resume: resume.additionalContext };
`);
    for (const text of [scenario.compact, scenario.resume] as string[]) {
      expect(text.startsWith("<omms-retrieval>")).toBe(true);
      expect(text).toContain("Restored Session Memory");
      expect(text).toContain("Claude session memory about the parser");
      expect(text).not.toContain("OpenCode memory that shares the id");
      expect(text).not.toContain("Other project memory");
      expect(text).not.toContain("Old project decision");
    }
  });

  it("returns the retrieval section for a prompt, and nothing for a private prompt", async () => {
    const { run } = createHarness({ ...EXTERNAL_API, similarityThreshold: 0 });
    const scenario = await run(`
${SEED_MEMORIES}
const prompt = await api.handleClaudeRetrieve({ event: "user-prompt-submit", session_id: "ses-new", cwd: projectDir, prompt: "How do we store memories?" });
const hidden = await api.handleClaudeRetrieve({ event: "user-prompt-submit", session_id: "ses-new", cwd: projectDir, prompt: "<private>secret question</private>" });
let bad = null;
try { await api.handleClaudeRetrieve({ event: "stop", session_id: "ses-new", cwd: projectDir }); } catch (error) { bad = error.status; }
scenario = { prompt: prompt.additionalContext, hidden: hidden.additionalContext, bad };
`);
    expect(scenario.prompt.startsWith("<omms-retrieval>")).toBe(true);
    expect(scenario.prompt).toContain("<memory_context>");
    expect(scenario.prompt).toContain("Old project decision about libSQL");
    expect(scenario.hidden).toBe("");
    expect(scenario.bad).toBe(400);
  });

  it("starts the Claude Code backfill once, on the first session start only", async () => {
    const { run } = createHarness();
    const scenario = await run(`
let started = 0;
const deps = { startBackfill: async () => { started++; } };
await api.handleClaudeRetrieve({ event: "user-prompt-submit", session_id: "s", cwd: projectDir, prompt: "hi" }, deps);
const afterPrompt = started;
await api.handleClaudeRetrieve({ event: "session-start", session_id: "s", cwd: projectDir, source: "startup" }, deps);
await api.handleClaudeRetrieve({ event: "session-start", session_id: "t", cwd: projectDir, source: "startup" }, deps);
scenario = { afterPrompt, started };
`);
    expect(scenario).toEqual({ afterPrompt: 0, started: 1 });
  });

  it("does not start the backfill when autoBackfill is off", async () => {
    const { run } = createHarness({ ...EXTERNAL_API, autoBackfill: false });
    const scenario = await run(`
let started = 0;
await api.handleClaudeRetrieve({ event: "session-start", session_id: "s", cwd: projectDir, source: "startup" }, { startBackfill: async () => { started++; } });
scenario = { started };
`);
    expect(scenario.started).toBe(0);
  });
});

describe("Claude Code capture", () => {
  it("captures only the last turn without a cursor, then only turns after the cursor", async () => {
    const { run } = createHarness();
    const scenario = await run(`
turn("1", "First question", "First answer");
turn("2", "Second question", "Second answer");
const reply = await capture();
const first = calls.map((c) => c.userPrompt);
turn("3", "Third question", "Third answer");
turn("4", "Fourth question", "Fourth answer");
await capture();
const second = calls.map((c) => c.userPrompt);
await capture();
const repeated = calls.length;
scenario = { reply, first, second, repeated, rows: await stored() };
`);
    expect(scenario.reply).toEqual({ queued: true });
    expect(scenario.first).toEqual(["Second question"]);
    expect(scenario.second).toEqual(["Second question", "Third question", "Fourth question"]);
    expect(scenario.repeated).toBe(3);
    expect(scenario.rows).toHaveLength(3);
    const row = scenario.rows.find((r: any) => r.metadata.promptId === "u-2");
    expect(row.metadata.host).toBe("claude-code");
    expect(row.metadata.hostSessionId).toBe("ses-1");
    expect(row.metadata.sourceType).toBe("live-capture");
    expect(row.metadata.sourceEntryIds).toEqual(["u-2", "a-2"]);
  });

  it("files every turn under the session's first directory, as the import does", async () => {
    const { run } = createHarness();
    const scenario = await run(`
turn("1", "Question one", "Answer one");
const elsewhere = join(projectDir, "..", "moved-elsewhere");
appendFileSync(transcript, entry("user", "u-2", "Question two", { cwd: elsewhere }));
appendFileSync(transcript, entry("assistant", "a-2", [{ type: "text", text: "Answer two" }], { cwd: elsewhere }));
await capture({ cwd: elsewhere });
scenario = { captured: calls.length, rows: await stored() };
`);
    // `stored()` lists the first directory's project, so the turn from the other directory must be there.
    expect(scenario.captured).toBe(1);
    expect(scenario.rows).toHaveLength(1);
  });

  it("uses the hook's final text when the transcript lags", async () => {
    const { run } = createHarness();
    const scenario = await run(`
turn("1", "Question one", "Partial text");
await capture({ last_assistant_message: "Final answer from the hook" });
turn("2", "Question two", null);
await capture({ last_assistant_message: "Reply only the hook saw" });
turn("3", "Question three", "Complete reply");
await capture({ last_assistant_message: "Complete reply" });
scenario = { calls };
`);
    const [lagging, missing, complete] = scenario.calls;
    expect(lagging.context).toContain("Partial text");
    expect(lagging.context).toContain("Final answer from the hook");
    expect(missing.userPrompt).toBe("Question two");
    expect(missing.context).toContain("Reply only the hook saw");
    expect(complete.context.split("Complete reply").length - 1).toBe(1);
  });

  it("skips a fully private prompt and strips private text and injected memories", async () => {
    const { run } = createHarness();
    const scenario = await run(`
turn("1", "<private>whole secret prompt</private>", "Reply to a secret");
await capture();
const afterPrivate = calls.length;
await capture();
turn("2", "Use key <private>abc123</private> now\\n<omms-retrieval>\\ninjected memory text\\n</omms-retrieval>", "Done <private>hidden reply</private>");
await capture();
scenario = { afterPrivate, calls, rows: await stored() };
`);
    expect(scenario.afterPrivate).toBe(0);
    expect(scenario.calls).toHaveLength(1);
    const call = scenario.calls[0];
    expect(call.userPrompt).toContain("Use key");
    for (const text of [call.userPrompt, call.context]) {
      expect(text).not.toContain("abc123");
      expect(text).not.toContain("hidden reply");
      expect(text).not.toContain("whole secret prompt");
      expect(text).not.toContain("injected memory text");
    }
    expect(scenario.rows).toHaveLength(1);
  });

  it("queues a retryable failure and moves the cursor on", async () => {
    const { run } = createHarness();
    const scenario = await run(`
turn("1", "Question during an outage", "Answer");
failWith = new Error("fetch failed");
await capture();
const queued = await countCaptureRetries(config.CONFIG);
failWith = null;
await capture();
scenario = { queued, calls: calls.length };
`);
    expect(scenario.queued["claude-code"]).toBe(1);
    expect(scenario.calls).toBe(1);
  });

  it("logs one metadata record and skips a missing or unreadable transcript", async () => {
    const { run } = createHarness();
    const scenario = await run(`
await (async () => {
  api.handleClaudeCapture({ session_id: "ses-missing", transcript_path: join(transcriptDir, "ses-missing.jsonl"), cwd: projectDir }, { captureProvider: () => provider });
  await api.whenClaudeCaptureIdle();
  writeFileSync(transcript, "not json\\n{broken\\n");
  await capture({ last_assistant_message: "private reply text" });
})();
const skips = logs.filter((l) => l.message === "Claude Code capture skipped");
let bad = null;
try { api.handleClaudeCapture({ session_id: "ses-1", cwd: projectDir }); } catch (error) { bad = error.status; }
scenario = { skips, calls: calls.length, bad, logText: JSON.stringify(logs) };
`);
    expect(scenario.calls).toBe(0);
    expect(scenario.skips.map((l: any) => l.data.code)).toEqual([
      "transcript-missing",
      "transcript-unreadable",
    ]);
    expect(scenario.bad).toBe(400);
    expect(scenario.logText).not.toContain("private reply text");
  });

  it("follows CLAUDE_CONFIG_DIR for the projects folder", async () => {
    const { run } = createHarness();
    const scenario = await run(`
const customConfig = join(otherProjectDir, "claude-config");
const customDir = join(customConfig, "projects", "-proj");
mkdirSync(customDir, { recursive: true });
const customTranscript = join(customDir, "ses-1.jsonl");
writeFileSync(customTranscript, "{}\\n");
process.env.CLAUDE_CONFIG_DIR = customConfig;
const statusOf = (path) => {
  try {
    api.handleClaudeCapture({ session_id: "ses-1", transcript_path: path, cwd: projectDir }, { captureProvider: () => provider });
    return 202;
  } catch (error) { return error.status; }
};
scenario = { custom: statusOf(customTranscript), defaultRoot: statusOf(transcript) };
await api.whenClaudeCaptureIdle();
`);
    expect(scenario.custom).toBe(202);
    expect(scenario.defaultRoot).toBe(400);
  });

  it("uses the claudeConfigDir setting over CLAUDE_CONFIG_DIR", async () => {
    const custom = mkdtempSync(join(tmpdir(), "omms-claude-hook-setting-"));
    tempDirs.push(custom);
    const { run } = createHarness({ ...EXTERNAL_API, claudeConfigDir: custom });
    const scenario = await run(`
const customDir = join(${JSON.stringify(custom)}, "projects", "-proj");
mkdirSync(customDir, { recursive: true });
const customTranscript = join(customDir, "ses-1.jsonl");
writeFileSync(customTranscript, "{}\\n");
const envConfig = join(otherProjectDir, "env-config");
const envDir = join(envConfig, "projects", "-proj");
mkdirSync(envDir, { recursive: true });
const envTranscript = join(envDir, "ses-1.jsonl");
writeFileSync(envTranscript, "{}\\n");
process.env.CLAUDE_CONFIG_DIR = envConfig;
const statusOf = (path) => {
  try {
    api.handleClaudeCapture({ session_id: "ses-1", transcript_path: path, cwd: projectDir }, { captureProvider: () => provider });
    return 202;
  } catch (error) { return error.status; }
};
scenario = { custom: statusOf(customTranscript), env: statusOf(envTranscript), defaultRoot: statusOf(transcript) };
await api.whenClaudeCaptureIdle();
`);
    expect(scenario).toEqual({ custom: 202, env: 400, defaultRoot: 400 });
  });

  it("uses a claudeConfigDir saved while the web app runs, without a restart", async () => {
    const custom = mkdtempSync(join(tmpdir(), "omms-claude-hook-live-"));
    tempDirs.push(custom);
    const { home, run } = createHarness();
    const globalFile = join(home, ".config", "omms", "omms.jsonc");
    const scenario = await run(`
delete process.env.CLAUDE_CONFIG_DIR;
const { readFileSync } = await import("node:fs");
const customDir = join(${JSON.stringify(custom)}, "projects", "-proj");
mkdirSync(customDir, { recursive: true });
const customTranscript = join(customDir, "ses-1.jsonl");
writeFileSync(customTranscript, "{}\\n");
const statusOf = (path) => {
  try {
    api.handleClaudeCapture({ session_id: "ses-1", transcript_path: path, cwd: projectDir }, { captureProvider: () => provider });
    return 202;
  } catch (error) { return error.status; }
};
const before = { custom: statusOf(customTranscript), defaultRoot: statusOf(transcript) };
await api.whenClaudeCaptureIdle();
// The Settings page saves the key into the global file.
const globalFile = ${JSON.stringify(globalFile)};
const saved = { ...JSON.parse(readFileSync(globalFile, "utf8")), claudeConfigDir: ${JSON.stringify(custom)} };
writeFileSync(globalFile, JSON.stringify(saved));
const after = { custom: statusOf(customTranscript), defaultRoot: statusOf(transcript) };
await api.whenClaudeCaptureIdle();
scenario = { before, after };
`);
    expect(scenario.before).toEqual({ custom: 400, defaultRoot: 202 });
    expect(scenario.after).toEqual({ custom: 202, defaultRoot: 400 });
  });

  it("accepts the projects folder when CLAUDE_CONFIG_DIR differs only in letter case", async () => {
    const { run } = createHarness();
    // Node's plain realpathSync keeps the letter case it is given; only .native
    // returns the case on disk. Bun already returns the case on disk, so the
    // test replaces the plain function to act like Node.
    const scenario = await run(`
const realFs = await import("node:fs");
const realConfig = join(otherProjectDir, "Case-Config");
const dir = join(realConfig, "projects", "-proj");
mkdirSync(dir, { recursive: true });
const file = join(dir, "ses-1.jsonl");
writeFileSync(file, "{}\\n");
const lowerConfig = join(otherProjectDir, "case-config");
// A case-sensitive file system has no such folder, so the check does not apply.
const caseInsensitive = realFs.existsSync(lowerConfig);
const nodeLikeRealpath = Object.assign(
  (path) => { realFs.statSync(path); return path; },
  { native: realFs.realpathSync.native }
);
mock.module("node:fs", () => ({ ...realFs, default: { ...realFs.default, realpathSync: nodeLikeRealpath }, realpathSync: nodeLikeRealpath }));
const nodeApi = await import(${JSON.stringify(moduleUrl("src/importer/claude-hook-api.js"))} + "?node-like");
process.env.CLAUDE_CONFIG_DIR = lowerConfig;
let status = 202;
try {
  nodeApi.handleClaudeCapture({ session_id: "ses-1", transcript_path: file, cwd: projectDir }, { captureProvider: () => provider });
} catch (error) { status = error.status; }
await nodeApi.whenClaudeCaptureIdle();
scenario = { caseInsensitive, status };
`);
    if (!scenario.caseInsensitive) return;
    expect(scenario.status).toBe(202);
  });

  it("rejects a transcript path outside the projects folder, a symlink out of it, or a wrong file name", async () => {
    const { run } = createHarness();
    const scenario = await run(`
turn(1, "Question one", "Answer one");
const outsideFile = join(otherProjectDir, "ses-1.jsonl");
writeFileSync(outsideFile, "{}\\n");
writeFileSync(join(otherProjectDir, "ses-2.jsonl"), "{}\\n");
writeFileSync(join(transcriptDir, "other.jsonl"), "{}\\n");
symlinkSync(otherProjectDir, join(projectsRoot, "-escape"));
symlinkSync(join(otherProjectDir, "ses-2.jsonl"), join(transcriptDir, "ses-2.jsonl"));

const attempts = {
  outsideRoot: ["ses-1", outsideFile],
  // Built by hand: path.join would collapse the ".." segments.
  dotDotEscape: ["ses-1", transcriptDir + "/../../../../../../../../../../.." + outsideFile],
  dirSymlinkEscape: ["ses-1", join(projectsRoot, "-escape", "ses-1.jsonl")],
  fileSymlinkEscape: ["ses-2", join(transcriptDir, "ses-2.jsonl")],
  wrongName: ["ses-1", join(transcriptDir, "other.jsonl")],
  otherSessionsFile: ["ses-3", transcript],
};
const status = {};
for (const [name, [sessionId, path]] of Object.entries(attempts)) {
  status[name] = null;
  try {
    api.handleClaudeCapture({ session_id: sessionId, transcript_path: path, cwd: projectDir }, { captureProvider: () => provider });
  } catch (error) { status[name] = error.status; }
}
await api.whenClaudeCaptureIdle();
const rejectedCalls = calls.length;
const valid = await capture();
scenario = { status, rejectedCalls, valid, validCalls: calls.length };
`);
    expect(scenario.status).toEqual({
      outsideRoot: 400,
      dotDotEscape: 400,
      dirSymlinkEscape: 400,
      fileSymlinkEscape: 400,
      wrongName: 400,
      otherSessionsFile: 400,
    });
    expect(scenario.rejectedCalls).toBe(0);
    expect(scenario.valid).toEqual({ queued: true });
    expect(scenario.validCalls).toBe(1);
  });

  it("records prompts and runs profile learning at the interval with the external model", async () => {
    const { run } = createHarness({ ...EXTERNAL_API, userProfileAnalysisInterval: 2 });
    const scenario = await run(`
const profileCalls = [];
const profileModel = { provider: "stub", modelId: "stub", async complete(_system, prompt) { profileCalls.push(prompt); throw new Error("profile model down"); } };
const send = async () => {
  api.handleClaudeCapture({ session_id: "ses-1", transcript_path: transcript, cwd: projectDir }, { captureProvider: () => provider, profileModel: () => profileModel });
  await api.whenClaudeCaptureIdle();
};
turn("1", "Prompt one for the profile", "Reply");
await send();
const afterOne = profileCalls.length;
turn("2", "Prompt two for the profile", "Reply");
await send();
turn("3", "Prompt three after a failed profile step", "Reply");
await send();
const { userPromptManager } = await import(${JSON.stringify(moduleUrl("src/services/user-prompt/user-prompt-manager.js"))});
const recorded = (await userPromptManager.getCapturedPrompts()).map((p) => p.content).sort();
const failures = logs.filter((l) => l.message === "Claude Code profile learning failed");
scenario = { afterOne, profileCalls, captures: calls.length, recorded, failures };
`);
    expect(scenario.afterOne).toBe(0);
    // After a failure the process waits 10 minutes before the next profile pass.
    expect(scenario.profileCalls).toHaveLength(1);
    expect(scenario.failures).toEqual([
      {
        message: "Claude Code profile learning failed",
        data: { host: "claude-code", reason: "error" },
      },
    ]);
    expect(JSON.stringify(scenario.failures)).not.toContain("Prompt");
    expect(scenario.profileCalls[0]).toContain("Prompt one for the profile");
    expect(scenario.profileCalls[0]).toContain("Prompt two for the profile");
    // A failed profile step does not block the next capture.
    expect(scenario.captures).toBe(3);
    expect(scenario.recorded).toEqual([
      "Prompt one for the profile",
      "Prompt three after a failed profile step",
      "Prompt two for the profile",
    ]);
  });

  it("makes no model call and logs the missing setting once when the external API is half configured", async () => {
    const { memoryApiKey: _omit, ...halfConfigured } = EXTERNAL_API;
    const { run } = createHarness(halfConfigured);
    const scenario = await run(`
turn("1", "Question", "Answer");
await capture();
await capture();
const off = logs.filter((l) => l.message === "Claude Code capture is off");
scenario = { calls: calls.length, off };
`);
    expect(scenario.calls).toBe(0);
    expect(scenario.off).toHaveLength(1);
    expect(scenario.off[0].data.issues).toContain("memoryApiKey is not configured");
  });
});

describe("Claude Code hook routes", () => {
  it("serves retrieve and capture with the token and rejects them without it", async () => {
    const { run } = createHarness();
    const scenario = await run(`
const { WebServer } = await import(${JSON.stringify(moduleUrl("src/services/web-server.js"))});
const { getOrCreateAuthToken } = await import(${JSON.stringify(moduleUrl("src/services/auth-token.js"))});
const token = getOrCreateAuthToken();
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747, directory: projectDir });
const post = (path, body, headers = {}) => server.handleRequest(new Request("http://127.0.0.1:4747" + path, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
const missing = join(transcriptDir, "ses-route.jsonl");
const captureBody = { session_id: "ses-route", transcript_path: missing, cwd: projectDir };
const deniedCapture = await post("/api/claude/capture", captureBody);
const deniedRetrieve = await post("/api/claude/retrieve", { event: "session-start", session_id: "s", cwd: projectDir, source: "startup" });
await api.whenClaudeCaptureIdle();
const readsWhileDenied = logs.filter((l) => l.message === "Claude Code capture skipped").length;
const retrieve = await post("/api/claude/retrieve", { event: "user-prompt-submit", session_id: "s", cwd: projectDir, prompt: "hello" }, { "x-omms-token": token });
const captured = await post("/api/claude/capture", captureBody, { "x-omms-token": token });
await api.whenClaudeCaptureIdle();
const badBody = await post("/api/claude/capture", { session_id: "s" }, { "x-omms-token": token });
const health = await (await server.handleRequest(new Request("http://127.0.0.1:4747/api/health"))).json();
scenario = {
  deniedCapture: deniedCapture.status, deniedRetrieve: deniedRetrieve.status, readsWhileDenied,
  retrieve: [retrieve.status, await retrieve.json()],
  capture: [captured.status, await captured.json()],
  readsAfter: logs.filter((l) => l.message === "Claude Code capture skipped").length,
  badBody: badBody.status, health,
};
`);
    expect(scenario.deniedCapture).toBe(401);
    expect(scenario.deniedRetrieve).toBe(401);
    expect(scenario.readsWhileDenied).toBe(0);
    expect(scenario.retrieve).toEqual([200, { additionalContext: "" }]);
    expect(scenario.capture).toEqual([202, { queued: true }]);
    expect(scenario.readsAfter).toBe(1);
    expect(scenario.badBody).toBe(400);
    expect(scenario.health.success).toBe(true);
    expect(scenario.health.status).toBe("ok");
  });
});
