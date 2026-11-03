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
  embed: async () => new Float32Array([0.25, 0.5, 0.75, 1]),
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
  it("adds nothing at startup or clear, whatever openingContext says", async () => {
    const { run } = createHarness({ ...EXTERNAL_API, openingContext: true });
    const scenario = await run(`
${SEED_MEMORIES}
const ask = (source) => api.handleClaudeRetrieve({ event: "session-start", session_id: "ses-new", cwd: projectDir, source });
scenario = {
  startup: (await ask("startup")).additionalContext,
  clear: (await ask("clear")).additionalContext,
  unknown: (await ask("something-else")).additionalContext,
  noSource: (await ask(undefined)).additionalContext,
};
`);
    expect(scenario).toEqual({ startup: "", clear: "", unknown: "", noSource: "" });
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

/** A project config at `<project>/.opencode/omms.jsonc`, as the config loader reads it. */
function writeProjectConfig(projectDir: string, config: Record<string, unknown>): void {
  mkdirSync(join(projectDir, ".opencode"), { recursive: true });
  writeFileSync(join(projectDir, ".opencode", "omms.jsonc"), JSON.stringify(config));
}

const COMPACT_ASK = `
const askRestore = (source) => api.handleClaudeRetrieve({ event: "session-start", session_id: "ses-1", cwd: projectDir, source });
scenario = {
  compact: (await askRestore("compact")).additionalContext,
  resume: (await askRestore("resume")).additionalContext,
  startup: (await askRestore("startup")).additionalContext,
};
`;

describe("Claude Code restore after compaction and resume", () => {
  it("restores for compact and resume, and adds nothing for startup", async () => {
    const { run } = createHarness();
    const scenario = await run(`${SEED_MEMORIES}${COMPACT_ASK}`);
    for (const text of [scenario.compact, scenario.resume] as string[]) {
      expect(text).toContain("Restored Session Memory");
      expect(text).toContain("Claude session memory about the parser");
    }
    expect(scenario.startup).toBe("");
  });

  it("restores nothing when compaction.enabled is false in the global config", async () => {
    const { run } = createHarness({ ...EXTERNAL_API, compaction: { enabled: false } });
    const scenario = await run(`${SEED_MEMORIES}${COMPACT_ASK}`);
    expect(scenario).toEqual({ compact: "", resume: "", startup: "" });
  });

  it("restores nothing when a project config sets compaction.enabled to false", async () => {
    const harness = createHarness();
    writeProjectConfig(harness.projectDir, { compaction: { enabled: false } });
    const scenario = await harness.run(`${SEED_MEMORIES}${COMPACT_ASK}`);
    expect(scenario).toEqual({ compact: "", resume: "", startup: "" });
  });
});

// Two searches with distinct answers: the prompt's, and the opening query's. The opening
// result repeats the prompt's memory, which the opening section must leave out.
const OPENING_SETUP = `
const PROMPT = "How do we store memories?";
const searched = [];
const rowsFor = {
  [PROMPT]: [{ id: "mem_prompt", similarity: 0.9, memory: "Prompt memory about libSQL storage" }],
  [config.CONFIG.openingContextQuery]: [
    { id: "mem_prompt", similarity: 0.8, memory: "Prompt memory about libSQL storage" },
    { id: "mem_open", similarity: 0.7, memory: "Opening memory about conventions" },
  ],
};
memoryClient.searchMemories = async (query) => {
  searched.push(query);
  return { success: true, results: rowsFor[query] ?? [] };
};
const ask = (extra = {}) => api.handleClaudeRetrieve({
  event: "user-prompt-submit", session_id: "ses-1", cwd: projectDir,
  prompt: PROMPT, transcript_path: transcript, ...extra,
});
`;
const OPENING_ON = { ...EXTERNAL_API, openingContext: true, openingContextQuery: "project setup" };
const OPEN_MARKER = '<!--omms:opening query="project setup"-->\n';

describe("Claude Code opening section", () => {
  it("adds the opening section after the prompt's section on the first prompt only", async () => {
    const scenario = await createHarness(OPENING_ON).run(`${OPENING_SETUP}
const first = (await ask()).additionalContext;
// The host has not written the second prompt yet: the web app's own record says it is not first.
const repeated = (await ask()).additionalContext;
turn("1", PROMPT, "A reply");
const second = (await ask()).additionalContext;
scenario = { first, repeated, second };
`);
    const { first } = scenario;
    expect(first.startsWith("<omms-retrieval>\n<memory_context>")).toBe(true);
    expect(first.endsWith("</omms-retrieval>")).toBe(true);
    expect(first.split("<omms-retrieval>")).toHaveLength(3);
    const at = first.indexOf(`<omms-retrieval>\n${OPEN_MARKER}<memory_context>`);
    expect(at).toBeGreaterThan(0);
    const promptPart = first.slice(0, at);
    const openingPart = first.slice(at);
    expect(promptPart).toContain("Prompt memory about libSQL storage");
    expect(promptPart).not.toContain("Opening memory");
    expect(openingPart).toContain("Opening memory about conventions");
    expect(openingPart).not.toContain("mem_prompt");
    expect(promptPart.trimEnd().endsWith("</omms-retrieval>")).toBe(true);
    for (const later of [scenario.repeated, scenario.second] as string[]) {
      expect(later.split("<omms-retrieval>")).toHaveLength(2);
      expect(later).not.toContain("omms:opening");
      expect(later).toContain("Prompt memory about libSQL storage");
    }
  });

  it("adds no opening section to a session whose transcript holds earlier prompts", async () => {
    // A new process has no record of the session, as after a web app restart.
    const scenario = await createHarness(OPENING_ON).run(`${OPENING_SETUP}
turn("0", "An earlier question", "An earlier reply");
scenario = (await ask()).additionalContext;
`);
    expect(scenario.split("<omms-retrieval>")).toHaveLength(2);
    expect(scenario).not.toContain("omms:opening");
    expect(scenario).toContain("Prompt memory about libSQL storage");
  });

  it("counts a prompt the host already wrote to the transcript as the first prompt", async () => {
    const scenario = await createHarness(OPENING_ON).run(`${OPENING_SETUP}
turn("1", PROMPT, null);
scenario = (await ask()).additionalContext;
`);
    expect(scenario).toContain(OPEN_MARKER);
  });

  it("does not count a slash command or skill entry as an earlier prompt", async () => {
    // Claude Code writes `<command-message>` entries for a custom command or a skill.
    const scenario = await createHarness(OPENING_ON).run(`${OPENING_SETUP}
appendFileSync(transcript, entry("user", "cmd-1", "<command-message>fixture-skill</command-message>\\n<command-name>/fixture-skill</command-name>\\n<command-args>tidy notes</command-args>"));
scenario = (await ask({ prompt: "/fixture-skill tidy notes" })).additionalContext;
`);
    expect(scenario).toContain(OPEN_MARKER);
  });

  it("counts a missing transcript file as first, and a missing or invalid path as not first", async () => {
    const scenario = await createHarness(OPENING_ON).run(`${OPENING_SETUP}
const missingFile = join(transcriptDir, "ses-missing.jsonl");
scenario = {
  missing: (await ask({ session_id: "ses-missing", transcript_path: missingFile })).additionalContext,
  // Nothing matches the prompt, so the opening section stands alone.
  openingOnly: (await ask({ session_id: "ses-missing-2", prompt: "Nothing matches this", transcript_path: join(transcriptDir, "ses-missing-2.jsonl") })).additionalContext,
  wrongName: (await ask({ session_id: "ses-bad", transcript_path: "/etc/hosts" })).additionalContext,
  outsideRoot: (await ask({ session_id: "ses-out", transcript_path: join(projectDir, "ses-out.jsonl") })).additionalContext,
  noPath: (await ask({ session_id: "ses-none", transcript_path: undefined })).additionalContext,
};
`);
    expect(scenario.missing).toContain(OPEN_MARKER);
    expect(
      scenario.openingOnly.startsWith(`<omms-retrieval>\n${OPEN_MARKER}<memory_context>`)
    ).toBe(true);
    expect(scenario.openingOnly.split("<omms-retrieval>")).toHaveLength(2);
    for (const key of ["wrongName", "outsideRoot", "noPath"]) {
      expect(scenario[key]).toContain("Prompt memory about libSQL storage");
      expect(scenario[key]).not.toContain("omms:opening");
    }
  });

  it("removes --> and double quotes from the query in the marker, and cuts it to 300 characters", async () => {
    const messy = await createHarness({
      ...OPENING_ON,
      openingContextQuery: 'say "hi" --> now',
    }).run(`${OPENING_SETUP}
scenario = (await ask()).additionalContext;
`);
    expect(messy).toContain('<omms-retrieval>\n<!--omms:opening query="say hi - now"-->\n');
    const long = await createHarness({ ...OPENING_ON, openingContextQuery: "q".repeat(500) })
      .run(`${OPENING_SETUP}
scenario = (await ask()).additionalContext;
`);
    expect(long).toContain(`<!--omms:opening query="${"q".repeat(300)}"-->\n`);
    expect(long).not.toContain("q".repeat(301));
  });

  it("returns today's output byte for byte when the option is off", async () => {
    const scenario = await createHarness({ ...EXTERNAL_API, openingContextQuery: "project setup" })
      .run(`${OPENING_SETUP}
const { buildRetrievalSection, retrievalWrapperBytes, wrapRetrievalSection } = await import(${JSON.stringify(moduleUrl("src/core/retrieval.js"))});
const section = await buildRetrievalSection(PROMPT, projectDir, "ses-1", {
  maxBytes: config.CONFIG.retrievalMaxTokens * 4, wrapperBytes: retrievalWrapperBytes(),
});
scenario = { answer: (await ask()).additionalContext, expected: wrapRetrievalSection(section), searched: searched.filter((q) => q === "project setup").length };
`);
    expect(scenario.answer).toBe(scenario.expected);
    expect(scenario.answer).not.toContain("<!--omms:");
    expect(scenario.searched).toBe(0);
  });

  it("adds nothing when per-prompt retrieval is off", async () => {
    const scenario = await createHarness({ ...OPENING_ON, chatMessage: { enabled: false } }).run(
      `${OPENING_SETUP}
scenario = (await ask()).additionalContext;
`
    );
    expect(scenario).toBe("");
  });
});

describe("Claude Code visibleRecall marker", () => {
  const MARKER = "<omms-retrieval>\n<!--omms:rows-off-->\n";
  const PROMPT_ASK = `
scenario = (await api.handleClaudeRetrieve({ event: "user-prompt-submit", session_id: "ses-new", cwd: projectDir, prompt: "How do we store memories?" })).additionalContext;
`;
  const recall = { ...EXTERNAL_API, similarityThreshold: 0 };

  it("puts the marker first in the prompt's section when the global value is false", async () => {
    const scenario = await createHarness({ ...recall, visibleRecall: false }).run(
      `${SEED_MEMORIES}${PROMPT_ASK}`
    );
    expect(scenario.startsWith(`${MARKER}<memory_context>`)).toBe(true);
    expect(scenario).toContain("Old project decision about libSQL");
    expect(scenario.trimEnd().endsWith("</omms-retrieval>")).toBe(true);
  });

  it("adds no marker when the setting is on", async () => {
    const scenario = await createHarness(recall).run(`${SEED_MEMORIES}${PROMPT_ASK}`);
    expect(scenario.startsWith("<omms-retrieval>\n<memory_context>")).toBe(true);
    expect(scenario).not.toContain("<!--omms:");
  });

  it("puts the marker in when a project config sets false", async () => {
    const harness = createHarness(recall);
    writeProjectConfig(harness.projectDir, { visibleRecall: false });
    const scenario = await harness.run(`${SEED_MEMORIES}${PROMPT_ASK}`);
    expect(scenario.startsWith(MARKER)).toBe(true);
  });

  it("keeps the marker when a project config sets true under a global false", async () => {
    const harness = createHarness({ ...recall, visibleRecall: false });
    writeProjectConfig(harness.projectDir, { visibleRecall: true });
    const scenario = await harness.run(`${SEED_MEMORIES}${PROMPT_ASK}`);
    expect(scenario.startsWith(MARKER)).toBe(true);
  });

  it("puts the marker in a restored section", async () => {
    const scenario = await createHarness({ ...EXTERNAL_API, visibleRecall: false }).run(
      `${SEED_MEMORIES}${COMPACT_ASK}`
    );
    for (const text of [scenario.compact, scenario.resume] as string[]) {
      expect(text.startsWith(`${MARKER}## Restored Session Memory`)).toBe(true);
      expect(text).toContain("Claude session memory about the parser");
    }
  });

  it("gives the opening section the rows-off marker and no opening marker", async () => {
    const scenario = await createHarness({ ...OPENING_ON, visibleRecall: false }).run(
      `${OPENING_SETUP}
scenario = (await ask()).additionalContext;
`
    );
    expect(scenario.split("<omms-retrieval>")).toHaveLength(3);
    expect(scenario.split(MARKER)).toHaveLength(3);
    expect(scenario).not.toContain("omms:opening");
    const openingPart = scenario.slice(scenario.indexOf("</omms-retrieval>"));
    expect(openingPart).toContain("Opening memory about conventions");
  });
});

describe("Claude Code subagent start", () => {
  const TASK = "Find where memories are stored in the libSQL layer";
  const SUBAGENT_SETUP = `
const TASK = ${JSON.stringify(TASK)};
const searched = [];
const rowsFor = {
  [TASK]: [{ id: "mem_task", similarity: 0.9, memory: "Task memory about libSQL storage" }],
  "first task": [{ id: "mem_first", similarity: 0.9, memory: "Memory for the first task" }],
  "second task": [{ id: "mem_second", similarity: 0.9, memory: "Memory for the second task" }],
};
memoryClient.searchMemories = async (query) => {
  searched.push(query);
  return { success: true, results: rowsFor[query] ?? [] };
};
const call = (id, name, input) =>
  appendFileSync(transcript, entry("assistant", "a-" + id, [{ type: "tool_use", id, name, input }]));
const answer = (id) =>
  appendFileSync(transcript, entry("user", "r-" + id, [{ type: "tool_result", tool_use_id: id, content: "done" }]));
const start = (agentType, extra = {}) => api.handleClaudeRetrieve({
  event: "subagent-start", session_id: "ses-1", cwd: projectDir,
  transcript_path: transcript, agent_type: agentType, ...extra,
}).then((reply) => reply.additionalContext);
turn("1", "Please explore the code", null);
`;
  const MARKER = "<omms-retrieval>\n<!--omms:rows-off-->\n";

  it("returns one rows-off section for the unanswered call of the same type", async () => {
    const scenario = await createHarness({ ...EXTERNAL_API, openingContext: true }).run(
      `${SUBAGENT_SETUP}
call("t1", "Agent", { description: "d", prompt: TASK, subagent_type: "Explore" });
scenario = { text: await start("Explore"), searched };
`
    );
    expect(scenario.text.startsWith(`${MARKER}<memory_context>`)).toBe(true);
    expect(scenario.text).toContain("Task memory about libSQL storage");
    expect(scenario.text.split("<omms-retrieval>")).toHaveLength(2);
    expect(scenario.text).not.toContain("omms:opening");
    expect(scenario.searched).toEqual([TASK]);
  });

  it("adds nothing when subagentMemory is false, globally or in a project", async () => {
    const body = `${SUBAGENT_SETUP}
call("t1", "Agent", { description: "d", prompt: TASK, subagent_type: "Explore" });
scenario = { text: await start("Explore"), searched };
`;
    const global = await createHarness({ ...EXTERNAL_API, subagentMemory: false }).run(body);
    expect(global).toEqual({ text: "", searched: [] });
    const harness = createHarness();
    writeProjectConfig(harness.projectDir, { subagentMemory: false });
    expect(await harness.run(body)).toEqual({ text: "", searched: [] });
  });

  it("adds nothing when no unanswered call of that type exists", async () => {
    const scenario = await createHarness().run(`${SUBAGENT_SETUP}
call("t1", "Agent", { prompt: TASK, subagent_type: "Explore" });
answer("t1");
call("t2", "Agent", { prompt: TASK, subagent_type: "Plan" });
scenario = {
  answeredAndOtherType: await start("Explore"),
  noType: await start("general-purpose"),
  noPath: await start("Plan", { transcript_path: undefined }),
  wrongName: await start("Plan", { transcript_path: "/etc/hosts" }),
  searched,
};
`);
    expect(scenario).toEqual({
      answeredAndOtherType: "",
      noType: "",
      noPath: "",
      wrongName: "",
      searched: [],
    });
  });

  it("gives parallel subagents of one type their own task, oldest call first, and each call once", async () => {
    const scenario = await createHarness().run(`${SUBAGENT_SETUP}
call("t1", "Agent", { prompt: "first task", subagent_type: "Explore" });
call("t2", "Agent", { prompt: "second task", subagent_type: "Explore" });
const first = await start("Explore");
const second = await start("Explore");
// Both calls are used. A start with no new call must not reuse one.
const third = await start("Explore");
scenario = { first, second, third, searched };
`);
    expect(scenario.first).toContain("Memory for the first task");
    expect(scenario.second).toContain("Memory for the second task");
    expect(scenario.third).toBe("");
    expect(scenario.searched).toEqual(["first task", "second task"]);
  });

  it("skips an answered call", async () => {
    const scenario = await createHarness().run(`${SUBAGENT_SETUP}
call("t1", "Agent", { prompt: "first task", subagent_type: "Explore" });
call("t2", "Agent", { prompt: "second task", subagent_type: "Explore" });
answer("t1");
const open = await start("Explore");
scenario = { open, searched };
`);
    expect(scenario.open).toContain("Memory for the second task");
    expect(scenario.searched).toEqual(["second task"]);
  });

  it("treats a background launch receipt as no answer, and uses the call once", async () => {
    // Claude Code writes the receipt as the call's tool_result as soon as it launches the agent.
    const scenario = await createHarness().run(`${SUBAGENT_SETUP}
call("t1", "Agent", { prompt: "first task", subagent_type: "Explore" });
appendFileSync(transcript, entry("user", "r-t1", [{ type: "tool_result", tool_use_id: "t1",
  content: "Async agent launched successfully.\\nagentId: a123 (internal ID)\\nThe agent is working in the background." }]));
const launched = await start("Explore");
// The receipt keeps t1 open, but it was used: a later start with no new call finds nothing.
const later = await start("Explore");
scenario = { launched, later, searched };
`);
    expect(scenario.launched).toContain("Memory for the first task");
    expect(scenario.later).toBe("");
    expect(scenario.searched).toEqual(["first task"]);
  });

  it("matches a call with no subagent_type to general-purpose, and reads the Task tool name", async () => {
    const scenario = await createHarness().run(`${SUBAGENT_SETUP}
call("t1", "Agent", { description: "d", prompt: TASK });
const general = await start("general-purpose");
const explore = await start("Explore");
call("t2", "Task", { prompt: "second task", subagent_type: "Explore" });
scenario = { general, explore };
`);
    expect(scenario.general).toContain("Task memory about libSQL storage");
    expect(scenario.general.startsWith(MARKER)).toBe(true);
    expect(scenario.explore).toBe("");
  });

  it("adds nothing for a fully private task prompt", async () => {
    const scenario = await createHarness().run(`${SUBAGENT_SETUP}
call("t1", "Agent", { prompt: "<private>secret task</private>", subagent_type: "Explore" });
scenario = { text: await start("Explore"), searched };
`);
    expect(scenario).toEqual({ text: "", searched: [] });
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

  it("keeps a category cleanup that lands while profile learning waits for the model", async () => {
    const { run } = createHarness({ ...EXTERNAL_API, userProfileAnalysisInterval: 1 });
    const scenario = await run(`
const { userProfileManager } = await import(${JSON.stringify(moduleUrl("src/services/user-profile/user-profile-manager.js"))});
const profileId = await userProfileManager.createProfile("dev@example.com", "Dev", "dev", "dev@example.com", {
  preferences: [{ category: "Old name", description: "Prefers short answers", confidence: 0.8, frequency: 3, evidence: ["e"], lastSeen: Date.now() }],
  patterns: [], workflows: [],
}, 0);
const profileCalls = [];
const profileModel = { provider: "stub", modelId: "stub", async complete(_system, prompt) {
  profileCalls.push(prompt);
  // A category cleanup renames the item while the model is still working.
  const current = await userProfileManager.getProfileById(profileId);
  const data = JSON.parse(current.profileData);
  data.preferences = data.preferences.map((item) => ({ ...item, category: "New name" }));
  await userProfileManager.updateProfile(profileId, data, 0, "Category cleanup", current.version);
  return JSON.stringify({
    preferences: [{ category: "Fresh topic", description: "Runs the failing test first", confidence: 0.7, evidence: ["e"] }],
    patterns: [], workflows: [],
  });
} };
turn("1", "Prompt for the cleanup race", "Reply");
api.handleClaudeCapture({ session_id: "ses-1", transcript_path: transcript, cwd: projectDir }, { captureProvider: () => provider, profileModel: () => profileModel });
await api.whenClaudeCaptureIdle();
const finalProfile = await userProfileManager.getProfileById(profileId);
scenario = {
  modelCalls: profileCalls.length,
  categories: JSON.parse(finalProfile.profileData).preferences.map((item) => item.category),
  failures: logs.filter((l) => l.message === "Claude Code profile learning failed"),
  finished: logs.filter((l) => l.message === "Claude Code profile learning finished").length,
};
`);
    expect(scenario.failures).toEqual([]);
    expect(scenario.finished).toBe(1);
    expect(scenario.modelCalls).toBe(1);
    expect(scenario.categories).toContain("New name");
    expect(scenario.categories).not.toContain("Old name");
  });

  it("keeps the prompts unanalysed when every profile save meets a newer version", async () => {
    const { run } = createHarness({ ...EXTERNAL_API, userProfileAnalysisInterval: 1 });
    const scenario = await run(`
const { userProfileManager } = await import(${JSON.stringify(moduleUrl("src/services/user-profile/user-profile-manager.js"))});
const { userPromptManager } = await import(${JSON.stringify(moduleUrl("src/services/user-prompt/user-prompt-manager.js"))});
await userProfileManager.createProfile("dev@example.com", "Dev", "dev", "dev@example.com", {
  preferences: [{ category: "Old name", description: "Prefers short answers", confidence: 0.8, frequency: 3, evidence: ["e"], lastSeen: Date.now() }],
  patterns: [], workflows: [],
}, 0);
let saveAttempts = 0;
userProfileManager.updateProfile = async () => { saveAttempts++; return false; };
let modelCalls = 0;
const profileModel = { provider: "stub", modelId: "stub", async complete() {
  modelCalls++;
  return JSON.stringify({ preferences: [], patterns: [], workflows: [] });
} };
turn("1", "Prompt for the conflict loop", "Reply");
api.handleClaudeCapture({ session_id: "ses-1", transcript_path: transcript, cwd: projectDir }, { captureProvider: () => provider, profileModel: () => profileModel });
await api.whenClaudeCaptureIdle();
scenario = {
  saveAttempts,
  modelCalls,
  unanalysed: await userPromptManager.countUnanalyzedForUserLearning(),
  failures: logs.filter((l) => l.message === "Claude Code profile learning failed"),
};
`);
    expect(scenario.modelCalls).toBe(1);
    expect(scenario.saveAttempts).toBe(3);
    expect(scenario.unanalysed).toBe(1);
    expect(scenario.failures).toHaveLength(1);
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

// Skill learning at the Stop hook (task 3.4). `skillTurns()` reads skills.db directly.
const SKILL_HELPERS = `
const { tursoConnectionManager } = await import(${JSON.stringify(moduleUrl("src/services/turso/connection-manager.js"))});
const { existsSync } = await import("node:fs");
const skillsDb = join(config.CONFIG.storagePath, "skills.db");
async function skillTurns() {
  if (!existsSync(skillsDb)) return null;
  const db = await tursoConnectionManager.getConnection(skillsDb);
  const rows = await db.all("SELECT turn_key, prompt, replies_json FROM turns ORDER BY id");
  const tools = await db.all("SELECT name, outcome, error FROM tool_calls ORDER BY id");
  return { rows: rows.map((r) => ({ ...r })), tools: tools.map((t) => ({ ...t })) };
}
function toolTurn(id, prompt) {
  appendFileSync(transcript, entry("user", "u-" + id, prompt));
  appendFileSync(transcript, entry("assistant", "a-" + id, [{ type: "tool_use", id: "t-" + id, name: "Bash", input: { command: "false" } }]));
  appendFileSync(transcript, entry("user", "r-" + id, [{ type: "tool_result", tool_use_id: "t-" + id, is_error: true, content: "exit 1" }]));
  appendFileSync(transcript, entry("assistant", "b-" + id, [{ type: "text", text: "It failed" }]));
}
`;
const SKILLS_ON = { ...EXTERNAL_API, skillLearning: true };

describe("Claude Code skill turns", () => {
  it("sends the same memory request with skills on and off, and records the raw turn", async () => {
    const code = `${SKILL_HELPERS}
toolTurn("1", "Run the check\\n<omms-retrieval>\\ninjected memory text\\n</omms-retrieval>");
await capture();
scenario = { calls, memories: (await stored()).map((m) => m.summary), skills: await skillTurns() };
`;
    const on = await createHarness(SKILLS_ON).run(code);
    const off = await createHarness().run(code);
    expect(on.calls).toEqual(off.calls);
    expect(on.memories).toEqual(off.memories);
    expect(off.skills).toBeNull();
    expect(on.skills.rows).toHaveLength(1);
    expect(on.skills.rows[0].turn_key).toBe("claude-code:ses-1:u-1");
    expect(on.skills.rows[0].prompt).toBe("Run the check");
    expect(on.skills.tools).toEqual([{ name: "Bash", outcome: "error", error: "exit 1" }]);
  });

  it("records a turn the memory extractor skips", async () => {
    const scenario = await createHarness(SKILLS_ON).run(`${SKILL_HELPERS}
provider.summarize = async () => ({ summary: "", type: "skip", tags: [] });
turn("1", "Just saying hi", "Hello");
await capture();
scenario = { memories: (await stored()).length, skills: await skillTurns() };
`);
    expect(scenario.memories).toBe(0);
    expect(scenario.skills.rows).toHaveLength(1);
  });

  it("logs skill-record-failed and still saves the memory when skills.db cannot open", async () => {
    const scenario = await createHarness(SKILLS_ON).run(`${SKILL_HELPERS}
mkdirSync(skillsDb, { recursive: true });
turn("1", "Question", "Answer");
await capture();
scenario = {
  memories: (await stored()).length,
  failed: logs.filter((l) => l.data?.code === "skill-record-failed").length,
};
`);
    expect(scenario).toEqual({ memories: 1, failed: 1 });
  });

  it("keeps one row when a quick retry runs the turn again", async () => {
    const scenario = await createHarness({ ...SKILLS_ON, autoCaptureMaxRetries: 3 })
      .run(`${SKILL_HELPERS}
let failures = 1;
const summarize = provider.summarize;
provider.summarize = async (request) => {
  if (failures-- > 0) throw new Error("model hiccup");
  return summarize(request);
};
turn("1", "Question", "Answer");
api.handleClaudeCapture(
  { session_id: "ses-1", transcript_path: transcript, cwd: projectDir },
  { captureProvider: () => provider, sleep: async () => {} }
);
await api.whenClaudeCaptureIdle();
scenario = { memories: (await stored()).length, skills: await skillTurns() };
`);
    expect(scenario.memories).toBe(1);
    expect(scenario.skills.rows).toHaveLength(1);
  });

  it("records private turns and turns after a blocked model", async () => {
    const scenario = await createHarness({ ...SKILLS_ON, skillLearningRedact: false })
      .run(`${SKILL_HELPERS}
turn("1", "First question", "First answer");
await capture();
turn("2", "<private>whole secret</private>", "Secret reply");
turn("3", "Third question", "Third answer");
turn("4", "Fourth question", "Fourth answer");
failWith = new Error("fetch failed");
await capture();
scenario = { calls: calls.length, skills: await skillTurns() };
`);
    // Turn 3 meets the outage, so turn 4 is queued without a model call.
    expect(scenario.calls).toBe(2);
    expect(scenario.skills.rows.map((r: any) => r.turn_key)).toEqual([
      "claude-code:ses-1:u-1",
      "claude-code:ses-1:u-2",
      "claude-code:ses-1:u-3",
      "claude-code:ses-1:u-4",
    ]);
    expect(scenario.skills.rows[1].prompt).toBe("<private>whole secret</private>");
  });

  it("records the last turn without moving the cursor when capture is off", async () => {
    const scenario = await createHarness({ ...SKILLS_ON, autoCaptureEnabled: false })
      .run(`${SKILL_HELPERS}
const { readClaudeCaptureCursor } = await import(${JSON.stringify(moduleUrl("src/services/claude-capture-cursor.js"))});
turn("1", "First question", "First answer");
turn("2", "Second question", "Second answer");
await capture();
turn("3", "Third question", "Third answer");
await capture();
scenario = {
  calls: calls.length,
  cursor: await readClaudeCaptureCursor("ses-1", config.CONFIG),
  keys: (await skillTurns()).rows.map((r) => r.turn_key),
};
`);
    expect(scenario).toEqual({
      calls: 0,
      cursor: null,
      keys: ["claude-code:ses-1:u-2", "claude-code:ses-1:u-3"],
    });
  });

  it("records turns when the external API is not configured", async () => {
    const { memoryApiKey: _omit, ...halfConfigured } = EXTERNAL_API;
    const scenario = await createHarness({ ...halfConfigured, skillLearning: true })
      .run(`${SKILL_HELPERS}
turn("1", "Question", "Answer");
await capture();
scenario = { calls: calls.length, rows: (await skillTurns()).rows.length };
`);
    expect(scenario).toEqual({ calls: 0, rows: 1 });
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
