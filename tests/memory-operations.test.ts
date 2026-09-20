import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const memoryOperationsUrl = new URL("../src/core/memory-operations.js", import.meta.url).href;
const clientUrl = new URL("../src/services/client.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;
const languageUrl = new URL("../src/services/language-detector.js", import.meta.url).href;
const profileManagerUrl = new URL(
  "../src/services/user-profile/user-profile-manager.js",
  import.meta.url
).href;

interface ScenarioResult {
  output: any;
  addCalls: any[];
  deleteCalls: string[];
  profileWrites: any[];
  activeProfileReads: string[];
}

function runScenario(body: string, overrides: { configured?: boolean } = {}): ScenarioResult {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-memory-operations-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

const addCalls = [];
const deleteCalls = [];
const profileWrites = [];
const activeProfileReads = [];
const mergeCalls = [];

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: {
    memory: { defaultScope: "project" },
    autoCaptureLanguage: "en",
  },
  isConfigured: () => ${overrides.configured === false ? "false" : "true"},
}));

mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    warmup: async () => {},
    ensureStorageReady: async () => {},
    getEmbeddingInitError: () => null,
    addMemory: async (content, containerTag, metadata) => {
      addCalls.push({ content, containerTag, metadata });
      return { success: true, id: \`mem-\${addCalls.length}\` };
    },
    searchMemories: async (query, containerTag, scope) => ({
      success: true,
      results: [
        { id: "mem-1", memory: "result text", similarity: 0.87 },
        { id: "mem-2", chunk: "chunk text", similarity: 0.61 },
      ],
      total: 2,
      timing: 0,
    }),
    listMemories: async (containerTag, limit) => ({
      success: true,
      memories: [
        { id: "mem-1", summary: "first memory", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "mem-2", summary: "second memory", createdAt: "2026-01-02T00:00:00.000Z" },
      ],
    }),
    deleteMemory: async (memoryId) => {
      deleteCalls.push(memoryId);
      return { success: true };
    },
    close() {},
  },
}));

mock.module(${JSON.stringify(tagsUrl)}, () => ({
  getTags: () => ({
    project: {
      tag: "opencode_project_test",
      displayName: "Test Project",
      userName: "Test User",
      userEmail: "test@example.com",
      projectPath: "/workspace",
      projectName: "workspace",
      gitRepoUrl: undefined,
    },
    user: { userEmail: "test@example.com", userName: "Test User" },
  }),
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));

mock.module(${JSON.stringify(languageUrl)}, () => ({
  detectLanguage: () => "en",
  getLanguageName: () => "English",
}));

mock.module(${JSON.stringify(profileManagerUrl)}, () => ({
  userProfileManager: {
    getActiveProfile: async (userId) => {
      activeProfileReads.push(userId);
      return {
        id: 42,
        userId,
        profileData: JSON.stringify({ preferences: [{ description: "prefers Bun" }] }),
        version: 3,
        lastAnalyzedAt: "2026-01-02T00:00:00.000Z",
      };
    },
    mergeProfileData: async (existing, incoming) => {
      mergeCalls.push({ existing, incoming });
      return {
        ...existing,
        preferences: [...(existing.preferences ?? []), ...(incoming.preferences ?? [])],
      };
    },
    updateProfile: async (profileId, data, _bump, note) => {
      profileWrites.push({ profileId, data, note });
      return { success: true };
    },
    createProfile: async (userId) => {
      profileWrites.push({ userId, created: true });
      return { success: true };
    },
  },
}));

const { executeMemoryOperation } = await import(${JSON.stringify(memoryOperationsUrl)});

let output;

${body}

console.log("RESULT:" + JSON.stringify({ addCalls, deleteCalls, profileWrites, activeProfileReads, mergeCalls, output }));
`;

  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: dir });
  const stdout = proc.stdout.toString();
  const match = stdout.match(/RESULT:(.*)$/m);
  if (!match) {
    throw new Error(`scenario produced no result: ${stdout}\n${proc.stderr.toString()}`);
  }
  const parsed = JSON.parse(match[1]);
  return {
    output: parsed.output,
    addCalls: parsed.addCalls,
    deleteCalls: parsed.deleteCalls,
    profileWrites: parsed.profileWrites,
    activeProfileReads: parsed.activeProfileReads,
  };
}

function run(args: any, context: any) {
  return `output = await executeMemoryOperation(${JSON.stringify(args)}, ${JSON.stringify(context)});`;
}

describe("memory operations (shared tool path) characterisation", () => {
  const context = { directory: "/workspace", host: "opencode" };

  it("add stores sanitized content with host provenance and parsed tags", () => {
    const result = runScenario(
      run({ mode: "add", content: "Use uv for Python envs", tags: "Python, Tooling " }, context)
    );

    expect(result.output.success).toBe(true);
    expect(result.output.id).toBe("mem-1");
    expect(result.addCalls.length).toBe(1);
    expect(result.addCalls[0].content).toBe("Use uv for Python envs");
    expect(result.addCalls[0].containerTag).toBe("opencode_project_test");
    expect(result.addCalls[0].metadata).toMatchObject({
      host: "opencode",
      tags: ["python", "tooling"],
    });
  });

  it("add redacts private segments before persistence", () => {
    const result = runScenario(
      run({ mode: "add", content: "key is <private>s3cret</private> rotate monthly" }, context)
    );

    expect(result.output.success).toBe(true);
    expect(result.addCalls[0].content).toBe("key is [REDACTED] rotate monthly");
  });

  it("add blocks fully private content", () => {
    const result = runScenario(
      run({ mode: "add", content: "<private>everything hidden</private>" }, context)
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toBe("Private content blocked");
    expect(result.addCalls.length).toBe(0);
  });

  it("add records the Pi host when called from the Pi adapter context", () => {
    const result = runScenario(
      run(
        { mode: "add", content: "marker" },
        { directory: "/workspace", host: "pi", hostSessionId: "pi-s1" }
      )
    );

    expect(result.addCalls[0].metadata).toMatchObject({ host: "pi", hostSessionId: "pi-s1" });
  });

  it("search returns formatted results with similarity percentages", () => {
    const result = runScenario(run({ mode: "search", query: "env management", limit: 5 }, context));

    expect(result.output.success).toBe(true);
    expect(result.output.count).toBe(2);
    expect(result.output.results).toEqual([
      { id: "mem-1", content: "result text", similarity: 87 },
      { id: "mem-2", content: "chunk text", similarity: 61 },
    ]);
  });

  it("list returns recent memories with count", () => {
    const result = runScenario(run({ mode: "list", limit: 10 }, context));

    expect(result.output.success).toBe(true);
    expect(result.output.count).toBe(2);
    expect(result.output.memories.map((m: any) => m.id)).toEqual(["mem-1", "mem-2"]);
  });

  it("forget deletes by memory id", () => {
    const result = runScenario(run({ mode: "forget", memoryId: "mem-2" }, context));

    expect(result.output.success).toBe(true);
    expect(result.deleteCalls).toEqual(["mem-2"]);
  });

  it("help documents every tool mode", () => {
    const result = runScenario(run({ mode: "help" }, context));

    expect(result.output.success).toBe(true);
    expect(result.output.message).toContain("Memory System Usage Guide");
    const commands = result.output.commands.map((c: any) => c.command);
    expect(commands).toEqual([
      "add",
      "search",
      "profile",
      "list",
      "forget",
      "list-shards",
      "migrate",
      "export",
      "import",
    ]);
  });

  it("profile read returns the active profile for the resolved user", () => {
    const result = runScenario(run({ mode: "profile" }, context));

    expect(result.output.success).toBe(true);
    expect(result.output.profile.version).toBe(3);
    expect(result.activeProfileReads).toEqual(["test@example.com"]);
  });

  it("profile write saves a sanitized explicit preference", () => {
    const result = runScenario(
      run({ mode: "profile", content: "prefers <private>token</private> dark themes" }, context)
    );

    expect(result.output.success).toBe(true);
    expect(result.output.message).toBe("Preference saved to profile");
    expect(result.profileWrites.length).toBe(1);
    expect(result.profileWrites[0].profileId).toBe(42);
    const savedPreference = result.profileWrites[0].data.preferences.at(-1);
    expect(savedPreference.description).toBe("prefers [REDACTED] dark themes");
    expect(savedPreference.confidence).toBe(1);
  });

  it("profile write without a resolvable user email is rejected", () => {
    const result = runScenario(
      `output = await executeMemoryOperation(${JSON.stringify({ mode: "profile", content: "prefers tabs" })}, ${JSON.stringify({ directory: "/workspace", host: "opencode", tags: { project: { tag: "opencode_project_test" }, user: { userEmail: undefined, userName: "Anon" } } })});`
    );

    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain("no user email could be resolved");
    expect(result.profileWrites.length).toBe(0);
  });

  it("reports a clear error when the memory system is not configured", () => {
    const result = runScenario(run({ mode: "add", content: "x" }, context), {
      configured: false,
    });

    expect(result.output).toEqual({
      success: false,
      error: "Memory system not configured properly.",
    });
    expect(result.addCalls.length).toBe(0);
  });

  it("add without content fails fast", () => {
    const result = runScenario(run({ mode: "add" }, context));

    expect(result.output.success).toBe(false);
    expect(result.output.error).toBe("content required");
    expect(result.addCalls.length).toBe(0);
  });
});
