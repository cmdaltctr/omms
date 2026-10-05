import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Delta spec "Memory limit changes take effect at the next relevant operation":
// an operation already in progress keeps its original limits, the next
// operation uses the new value, and stored data never changes. Each scenario
// mutates or reloads a limit during a deferred await inside one operation and
// checks the three properties. Every scenario runs in its own process with a
// temporary HOME, config, and store.

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const moduleUrl = (path: string) => pathToFileURL(join(import.meta.dir, "..", path)).href;

interface StoreHarness {
  home: string;
  projectDir: string;
  run: (code: string) => Promise<any>;
}

/** A child process with a real store, real config file, and stubbed embeddings. */
function createStoreHarness(config: Record<string, unknown>): StoreHarness {
  const home = mkdtempSync(join(tmpdir(), "omms-snapshot-home-"));
  const projectDir = mkdtempSync(join(tmpdir(), "omms-snapshot-project-"));
  tempDirs.push(home, projectDir);
  const configPath = join(home, ".config", "omms", "omms.jsonc");
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  const writeConfig = (extra: Record<string, unknown>) =>
    writeFileSync(
      configPath,
      JSON.stringify({
        storagePath: join(home, "store"),
        embeddingDimensions: 4,
        userEmailOverride: "dev@example.com",
        injectProfile: false,
        ...extra,
      })
    );
  writeConfig(config);

  const run = async (code: string): Promise<any> => {
    const script = `
const { mock } = await import("bun:test");
let releaseEmbedding = null;
const embeddingStub = {
  embedWithTimeout: async () => {
    if (releaseEmbedding) await releaseEmbedding;
    return new Float32Array([0.25, 0.5, 0.75, 1]);
  },
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

const projectDir = ${JSON.stringify(projectDir)};
const config = await import(${JSON.stringify(moduleUrl("src/config.js"))});
config.initConfig(projectDir);
const { memoryClient } = await import(${JSON.stringify(moduleUrl("src/services/client.js"))});
const { getTags } = await import(${JSON.stringify(moduleUrl("src/services/tags.js"))});
const tag = getTags(projectDir).project.tag;
const byteLength = (text) => Buffer.byteLength(String(text), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        OMMS_DISABLE_AUTO_BACKFILL: "1",
      },
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const match = stdout.match(/RESULT:(.*)$/m);
    if (!match) throw new Error(`scenario produced no result: ${stdout}\n${stderr}`);
    return JSON.parse(match[1]!);
  };

  return { home, projectDir, run };
}

/** A child process with a real config file and fully stubbed client/tag modules. */
function createMockHarness(mocks: { client?: string; tags?: string }, code: string): Promise<any> {
  const dir = mkdtempSync(join(tmpdir(), "omms-snapshot-mock-"));
  tempDirs.push(dir);
  const home = mkdtempSync(join(tmpdir(), "omms-snapshot-mockhome-"));
  tempDirs.push(home);
  mkdirSync(join(home, ".config", "omms"), { recursive: true });

  const script = `
const { mock } = await import("bun:test");
mock.module(${JSON.stringify(moduleUrl("src/services/logger.js"))}, () => ({ log: () => {} }));
const logs = [];
${mocks.client ?? ""}
${mocks.tags ?? ""}

const config = await import(${JSON.stringify(moduleUrl("src/config.js"))});
const projectDir = "/workspace/project";
const byteLength = (text) => Buffer.byteLength(String(text), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let scenario;
${code}

console.log("RESULT:" + JSON.stringify(scenario ?? null));
// Some import chains (profile learning) leave long timers alive; exit explicitly.
process.exit(0);
`;
  const scriptPath = join(dir, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_SKIP_LEGACY_MIGRATION: "1",
      OMMS_DISABLE_AUTO_BACKFILL: "1",
    },
  });
  const stdout = Buffer.from(proc.stdout).toString("utf8");
  const stderr = Buffer.from(proc.stderr).toString("utf8");
  const match = stdout.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(`scenario produced no result: ${stdout}\n${stderr}`);
  return Promise.resolve(JSON.parse(match[1]!));
}

describe("memory limits keep one snapshot per operation (memory-context-controls)", () => {
  it("searchMemories keeps the maxMemories count captured at search entry", async () => {
    const h = createStoreHarness({ maxMemories: 6 });
    const output = await h.run(`
for (let i = 0; i < 6; i++) {
  await memoryClient.addMemory("stored decision number " + i, tag, { sessionID: "seed" });
}

// Hold the query embedding so the limit can change mid-operation.
let gateResolve;
releaseEmbedding = new Promise((resolve) => { gateResolve = resolve; });
const searchPromise = memoryClient.searchMemories("stored decision", tag);
await sleep(20);
const entryCount = config.CONFIG.maxMemories;
config.CONFIG.maxMemories = 2;
gateResolve();
const first = await searchPromise;
releaseEmbedding = null;

const next = await memoryClient.searchMemories("stored decision", tag);
const listed = await memoryClient.listMemories(tag, 50);
scenario = {
  entryCount,
  firstCount: first.results.length,
  nextCount: next.results.length,
  storedCount: listed.memories.length,
};
`);

    expect(output.entryCount).toBe(6);
    // The in-flight search kept the count it captured at entry.
    expect(output.firstCount).toBe(6);
    // The next search uses the new limit.
    expect(output.nextCount).toBe(2);
    // Stored data is unchanged.
    expect(output.storedCount).toBe(6);
  });

  it("buildRetrievalSection keeps the exclusion flag captured before the search", async () => {
    const output = await createMockHarness(
      {
        client: `
let releaseSearch = null;
mock.module(${JSON.stringify(moduleUrl("src/services/client.js"))}, () => ({
  memoryClient: {
    searchMemories: async () => {
      if (releaseSearch) await releaseSearch;
      return {
        success: true,
        results: [
          { id: "own", memory: "OWN SESSION NOTE", similarity: 0.9, metadata: { sessionID: "ses-1" } },
          { id: "other", memory: "OTHER SESSION NOTE", similarity: 0.8, metadata: { sessionID: "ses-2" } },
        ],
      };
    },
  },
}));`,
        tags: `
mock.module(${JSON.stringify(moduleUrl("src/services/tags.js"))}, () => ({
  getTags: () => ({
    project: { tag: "project-tag" },
    user: { userEmail: "dev@example.com" },
  }),
}));`,
      },
      `
config.initConfig(projectDir, { strict: false });
config.CONFIG.injectProfile = false;
config.CONFIG.chatMessage.excludeCurrentSession = true;
const { buildRetrievalSection } = await import(${JSON.stringify(moduleUrl("src/core/retrieval.js"))});

let gateResolve;
releaseSearch = new Promise((resolve) => { gateResolve = resolve; });
const entryFlag = config.CONFIG.chatMessage.excludeCurrentSession;
const firstPromise = buildRetrievalSection("what was decided", projectDir, "ses-1");
await sleep(20);
config.CONFIG.chatMessage.excludeCurrentSession = false;
gateResolve();
const first = (await firstPromise) || "";
releaseSearch = null;

const next = (await buildRetrievalSection("what was decided", projectDir, "ses-1")) || "";
scenario = {
  entryFlag,
  firstKeepsOwnOut: !first.includes("OWN SESSION NOTE"),
  firstHasOther: first.includes("OTHER SESSION NOTE"),
  nextIncludesOwn: next.includes("OWN SESSION NOTE"),
  nextHasOther: next.includes("OTHER SESSION NOTE"),
};
`
    );

    expect(output.entryFlag).toBe(true);
    // The in-flight retrieval kept the entry flag: own session stays excluded.
    expect(output.firstKeepsOwnOut).toBe(true);
    expect(output.firstHasOther).toBe(true);
    // The next retrieval uses the new flag: both memories appear.
    expect(output.nextIncludesOwn).toBe(true);
    expect(output.nextHasOther).toBe(true);
  });

  it("captureConversation keeps the context budget captured before its first await", async () => {
    const output = await createMockHarness(
      {
        client: `
let releaseList = null;
mock.module(${JSON.stringify(moduleUrl("src/services/client.js"))}, () => ({
  memoryClient: {
    listMemories: async () => {
      if (releaseList) await releaseList;
      return { success: true, memories: [{ summary: "latest", createdAt: new Date().toISOString() }] };
    },
    addMemory: async (...args) => { throw new Error("store must not be written: " + JSON.stringify(args)); },
  },
}));`,
        tags: `
mock.module(${JSON.stringify(moduleUrl("src/services/tags.js"))}, () => ({
  getTags: () => ({ project: { tag: "project-tag" }, user: { userEmail: "dev@example.com" } }),
}));`,
      },
      `
config.initConfig(projectDir, { strict: false });
config.CONFIG.autoCaptureMaxContextBytes = 131072;
const { captureConversation } = await import(${JSON.stringify(moduleUrl("src/core/capture.js"))});

const unit = () => ({
  host: "pi",
  hostSessionId: "ses-1",
  sourceType: "live-capture",
  projectDirectory: projectDir,
  userPrompt: "p".repeat(40000),
  textResponses: ["r".repeat(40000), "r".repeat(40000)],
  toolCalls: [],
});
const contexts = [];
const provider = { summarize: async (request) => { contexts.push(byteLength(request.context)); return { type: "skip" }; } };

let gateResolve;
releaseList = new Promise((resolve) => { gateResolve = resolve; });
const firstPromise = captureConversation(unit(), provider);
await sleep(20);
const entryTotal = config.CONFIG.autoCaptureMaxContextBytes;
config.CONFIG.autoCaptureMaxContextBytes = 65536;
gateResolve();
const first = await firstPromise;
releaseList = null;

const second = await captureConversation(unit(), provider);
scenario = {
  entryTotal,
  firstStatus: first.status,
  firstContextBytes: contexts[0],
  secondContextBytes: contexts[1],
  storedWrites: 0,
};
`
    );

    expect(output.entryTotal).toBe(131072);
    expect(output.firstStatus).toBe("skipped");
    // The in-flight capture kept the 131,072-byte total: its markdown budget
    // is 131072 - 24576 = 106,496, far above the mutated budget's 49,152.
    expect(output.firstContextBytes).toBeGreaterThan(60_000);
    expect(output.firstContextBytes).toBeLessThanOrEqual(106_496);
    // The next capture uses the new 65,536-byte total.
    expect(output.secondContextBytes).toBeLessThanOrEqual(49_152);
    expect(output.secondContextBytes).toBeGreaterThan(40_000);
    expect(output.storedWrites).toBe(0);
  });

  it("performUserProfileLearning keeps the byte limit captured after its refresh", async () => {
    const learningUrl = moduleUrl("src/adapters/opencode/profile-learning.js");
    const output = await createMockHarness(
      {
        client: `
mock.module(${JSON.stringify(moduleUrl("src/services/client.js"))}, () => ({
  memoryClient: {},
}));`,
        tags: `
mock.module(${JSON.stringify(moduleUrl("src/services/tags.js"))}, () => ({
  getTags: () => ({
    project: { tag: "project-tag" },
    user: { tag: "user", displayName: "Dev", userName: "dev", userEmail: "dev@example.com" },
  }),
}));`,
      },
      `
mock.module(${JSON.stringify(moduleUrl("src/adapters/opencode/opencode-provider-loader.js"))}, () => ({
  loadOpencodeProvider: async () => ({
    generateStructuredOutput: async (request) => {
      contexts.push(byteLength(request.userPrompt));
      return { preferences: [], patterns: [], workflows: [] };
    },
  }),
}));
mock.module(${JSON.stringify(moduleUrl("src/adapters/opencode/profile-llm-client.js"))}, () => ({
  getOpenCodeClient: async () => ({}),
}));
const prompts = Array.from({ length: 10 }, (_, i) => ({
  id: "p" + i, sessionId: "ses-1", messageId: "m" + i, projectPath: projectDir,
  content: "第" + i + "条用户偏好记录：遵循中文注释规范 والرد بالعربية 🚀 ".repeat(6),
  createdAt: i + 1, captured: false, user_learning_captured: false, capture_attempts: 0,
}));
const promptsCopy = JSON.stringify(prompts.map((p) => p.content));
let releasePrompts = null;
mock.module(${JSON.stringify(moduleUrl("src/services/user-prompt/user-prompt-manager.js"))}, () => ({
  userPromptManager: {
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => 10,
    getPromptsForUserLearning: async () => {
      if (releasePrompts) await releasePrompts;
      return prompts;
    },
    markMultipleAsUserLearningCaptured: async () => {},
  },
}));
mock.module(${JSON.stringify(moduleUrl("src/services/user-profile/user-profile-manager.js"))}, () => ({
  userProfileManager: {
    getActiveProfile: async () => null,
    createProfile: async () => ({}),
    mergeProfileData: async () => ({}),
    updateProfile: async () => true,
    decayInMemory: (d) => ({ data: d }),
    syncConfidence: () => {},
  },
}));

config.initConfig(projectDir, { strict: false });
config.CONFIG.userProfileMaxContextBytes = 8192;
config.CONFIG.autoCaptureProviderStatus = { ready: true, mode: "opencode", issues: [] };
config.CONFIG.userProfileAnalysisInterval = 5;
config.CONFIG.userProfileValidationEnabled = false;
config.CONFIG.showUserProfileToasts = false;
config.CONFIG.opencodeProvider = "opencode-go";
config.CONFIG.opencodeModel = "test-model";
const contexts = [];
const { performUserProfileLearning } = await import(${JSON.stringify(learningUrl)});

let gateResolve;
releasePrompts = new Promise((resolve) => { gateResolve = resolve; });
const firstPromise = performUserProfileLearning({}, projectDir);
await sleep(20);
const entryLimit = config.CONFIG.userProfileMaxContextBytes;
config.CONFIG.userProfileMaxContextBytes = 2048;
gateResolve();
await firstPromise;
releasePrompts = null;

await performUserProfileLearning({}, projectDir);
scenario = {
  entryLimit,
  firstBytes: contexts[0],
  nextBytes: contexts[1],
  promptsUnchanged: JSON.stringify(prompts.map((p) => p.content)) === promptsCopy,
};
`
    );

    expect(output.entryLimit).toBe(8192);
    // The in-flight pass kept the 8,192-byte limit.
    expect(output.firstBytes).toBeLessThanOrEqual(8192);
    expect(output.firstBytes).toBeGreaterThan(2048);
    // The next pass uses the new 2,048-byte limit.
    expect(output.nextBytes).toBeLessThanOrEqual(2048);
    expect(output.promptsUnchanged).toBe(true);
  });

  it("a manual memory search picks up a changed config file at the next operation", async () => {
    const h = createStoreHarness({ maxMemories: 6 });
    const output = await h.run(`
for (let i = 0; i < 6; i++) {
  await memoryClient.addMemory("manual search seed " + i, tag, { sessionID: "seed" });
}
const { executeMemoryOperation } = await import(${JSON.stringify(
      moduleUrl("src/core/memory-operations.js")
    )});

const first = await executeMemoryOperation(
  { mode: "search", query: "manual search seed" },
  { directory: projectDir }
);

// A valid hand edit lands while the tool is idle.
const { writeFileSync } = await import("node:fs");
writeFileSync(${JSON.stringify(join(h.home, ".config", "omms", "omms.jsonc"))}, JSON.stringify({
  storagePath: ${JSON.stringify(join(h.home, "store"))},
  embeddingDimensions: 4,
  userEmailOverride: "dev@example.com",
  injectProfile: false,
  maxMemories: 2,
}));

const next = await executeMemoryOperation(
  { mode: "search", query: "manual search seed" },
  { directory: projectDir }
);
const listed = await memoryClient.listMemories(tag, 50);
scenario = {
  firstCount: first.count,
  nextCount: next.count,
  storedCount: listed.memories.length,
};
`);

    expect(output.firstCount).toBe(6);
    // The next manual search uses the edited file's limit.
    expect(output.nextCount).toBe(2);
    expect(output.storedCount).toBe(6);
  });
});
