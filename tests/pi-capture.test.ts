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

const captureUrl = new URL("../src/adapters/pi/capture.js", import.meta.url).href;
const clientUrl = new URL("../src/services/client.js", import.meta.url).href;
const configUrl = new URL("../src/config.js", import.meta.url).href;
const tagsUrl = new URL("../src/services/tags.js", import.meta.url).href;
const loggerUrl = new URL("../src/services/logger.js", import.meta.url).href;

function runScenario(scriptBody: string): any {
  const dir = mkdtempSync(join(tmpdir(), "opencode-mem-pi-capture-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

const addCalls = [];
let summarizeCalls = 0;
let captureMode = ${JSON.stringify(scriptBody.initialCaptureMode ?? "capture")};

mock.module(${JSON.stringify(configUrl)}, () => ({
  CONFIG: {
    autoCaptureEnabled: true,
    autoCaptureMaxContextBytes: 131072,
    showAutoCaptureToasts: false,
    showErrorToasts: false,
    chatMessage: { enabled: true },
  },
}));

mock.module(${JSON.stringify(clientUrl)}, () => ({
  memoryClient: {
    listMemories: async () => ({ success: true, memories: [] }),
    addMemory: async (content, _tag, metadata) => {
      addCalls.push({ content, metadata });
      return { success: true, id: \`mem-\${addCalls.length}\` };
    },
    getEmbeddingInitError: () => null,
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
  }),
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({ log: () => {} }));

const { capturePiSettledWorkUnit, createPiCaptureState } = await import(
  ${JSON.stringify(captureUrl)}
);

function userEntry(id, text) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T10:00:00.000Z",
    message: { role: "user", content: text },
  };
}

function assistantEntry(id, text) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T10:00:05.000Z",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

const provider = {
  summarize: async (request) => {
    summarizeCalls += 1;
    if (captureMode === "fail") {
      throw new Error("extraction unavailable");
    }
    if (captureMode === "skip") {
      return { summary: "", type: "skip", tags: [] };
    }
    return { summary: \`summary of \${request.userPrompt}\`, type: "discussion", tags: ["pi"] };
  },
};

let scenario;

${scriptBody.code}

console.log(
  "RESULT:" +
    JSON.stringify({
      addCalls,
      summarizeCalls,
      results: typeof scenario !== "undefined" ? scenario : null,
    })
);
`;

  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bun", "run", scriptPath], { cwd: dir });
  const stdout = proc.stdout.toString();
  const match = stdout.match(/RESULT:(.*)$/m);
  if (!match) {
    throw new Error(`scenario produced no result: ${stdout}\n${proc.stderr.toString()}`);
  }
  return JSON.parse(match[1]);
}

describe("Pi settled capture orchestration", () => {
  it("persists the settled work unit with Pi provenance", () => {
    const output = runScenario({
      code: `
const state = createPiCaptureState();
const entries = [
  userEntry("u-1", "Add a retry to the uploader"),
  assistantEntry("a-1", "Added retry with backoff to uploader.ts"),
];
const result = await capturePiSettledWorkUnit({
  sessionId: "pi-session-1",
  directory: "/workspace",
  entries,
  provider,
  state,
  prompt: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
});
scenario = result;
`,
    });

    expect(output.results.status).toBe("captured");
    expect(output.addCalls.length).toBe(1);
    expect(output.addCalls[0].content).toContain("summary of Add a retry to the uploader");
    expect(output.addCalls[0].metadata).toMatchObject({
      host: "pi",
      hostSessionId: "pi-session-1",
      sourceType: "live-capture",
      promptId: "u-1",
      sourceEntryIds: ["a-1"],
    });
  });

  it("does not recapture the same work unit on repeated settled events", () => {
    const output = runScenario({
      code: `
const state = createPiCaptureState();
const entries = [
  userEntry("u-1", "prompt one"),
  assistantEntry("a-1", "work one"),
];
const first = await capturePiSettledWorkUnit({
  sessionId: "s1", directory: "/workspace", entries, provider, state,
});
const second = await capturePiSettledWorkUnit({
  sessionId: "s1", directory: "/workspace", entries, provider, state,
});
const third = await capturePiSettledWorkUnit({
  sessionId: "s1", directory: "/workspace", entries, provider, state,
});
scenario = { first, second, third };
`,
    });

    expect(output.results.first.status).toBe("captured");
    expect(output.results.second.status).toBe("skipped");
    expect(output.results.second.reason).toBe("already-handled");
    expect(output.results.third.reason).toBe("already-handled");
    expect(output.addCalls.length).toBe(1);
    expect(output.summarizeCalls).toBe(1);
  });

  it("captures each prompt's own window across a multi-prompt session", () => {
    const output = runScenario({
      code: `
const state = createPiCaptureState();
const promptA = [userEntry("u-1", "prompt A"), assistantEntry("a-1", "work A")];
const settledA = await capturePiSettledWorkUnit({
  sessionId: "s1", directory: "/workspace", entries: promptA, provider, state,
});
const fullBranch = [...promptA, userEntry("u-2", "prompt B"), assistantEntry("a-2", "work B")];
const settledB = await capturePiSettledWorkUnit({
  sessionId: "s1", directory: "/workspace", entries: fullBranch, provider, state,
});
scenario = { settledA, settledB };
`,
    });

    expect(output.results.settledA.status).toBe("captured");
    expect(output.results.settledB.status).toBe("captured");
    expect(output.addCalls.length).toBe(2);
    expect(output.addCalls[0].content).toContain("prompt A");
    expect(output.addCalls[0].content).not.toContain("prompt B");
    expect(output.addCalls[0].metadata.sourceEntryIds).toEqual(["a-1"]);
    expect(output.addCalls[1].content).toContain("prompt B");
    expect(output.addCalls[1].metadata.sourceEntryIds).toEqual(["a-2"]);
  });

  it("captures exactly once when compaction and continuation occurred mid-run", () => {
    const output = runScenario({
      code: `
const state = createPiCaptureState();
const overflowBranch = [
  userEntry("u-1", "big task"),
  assistantEntry("a-1", "first half of the work"),
  { type: "compaction", id: "c-1", parentId: "a-1", timestamp: "2026-01-01T10:00:06.000Z", summary: "summarised" },
  assistantEntry("a-2", "second half after compaction retry"),
];
const first = await capturePiSettledWorkUnit({
  sessionId: "s1", directory: "/workspace", entries: overflowBranch, provider, state,
});
const retrySettled = await capturePiSettledWorkUnit({
  sessionId: "s1", directory: "/workspace", entries: overflowBranch, provider, state,
});
scenario = { first, retrySettled };
`,
    });

    expect(output.results.first.status).toBe("captured");
    expect(output.results.retrySettled.reason).toBe("already-handled");
    expect(output.addCalls.length).toBe(1);
    expect(output.addCalls[0].metadata.sourceEntryIds).toEqual(["a-1", "a-2"]);
  });

  it("treats an extractor skip as terminal", () => {
    const output = runScenario({
      initialCaptureMode: "skip",
      code: `
const state = createPiCaptureState();
const entries = [userEntry("u-1", "hi there"), assistantEntry("a-1", "hello!")];
const first = await capturePiSettledWorkUnit({
  sessionId: "s1", directory: "/workspace", entries, provider, state,
});
const second = await capturePiSettledWorkUnit({
  sessionId: "s1", directory: "/workspace", entries, provider, state,
});
scenario = { first, second };
`,
    });

    expect(output.results.first.status).toBe("skipped");
    expect(output.results.first.reason).toBe("extractor-skip");
    expect(output.results.second.reason).toBe("already-handled");
    expect(output.addCalls.length).toBe(0);
  });

  it("keeps a failed capture retryable and never blocks later work", () => {
    const output = runScenario({
      code: `
const state = createPiCaptureState();
const entries = [userEntry("u-1", "prompt"), assistantEntry("a-1", "work")];
captureMode = "fail";
const failed = await capturePiSettledWorkUnit({
  sessionId: "s1", directory: "/workspace", entries, provider, state,
});
captureMode = "capture";
const retried = await capturePiSettledWorkUnit({
  sessionId: "s1", directory: "/workspace", entries, provider, state,
});
scenario = { failed, retried };
`,
    });

    expect(output.results.failed.status).toBe("failed");
    expect(output.results.failed.error).toContain("extraction unavailable");
    expect(output.results.retried.status).toBe("captured");
    expect(output.addCalls.length).toBe(1);
  });

  it("skips capture when the settled branch has no response window", () => {
    const output = runScenario({
      code: `
const state = createPiCaptureState();
const result = await capturePiSettledWorkUnit({
  sessionId: "s1",
  directory: "/workspace",
  entries: [userEntry("u-1", "only a prompt")],
  provider,
  state,
});
scenario = result;
`,
    });

    expect(output.results.status).toBe("skipped");
    expect(output.results.reason).toBe("no-window");
    expect(output.summarizeCalls).toBe(0);
  });
});
