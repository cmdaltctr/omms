import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const logged: Array<{ message: string; data: unknown }> = [];
const config = { captureTrace: false } as Record<string, unknown>;
const budgetArgs: Array<number | undefined> = [];
let addMemoryResult: { success: boolean; id?: string; error?: string } = {
  success: true,
  id: "m1",
};

mock.module("../src/config.js", () => ({ CONFIG: config, refreshConfigIfChanged: () => {} }));
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: unknown) => logged.push({ message, data }),
}));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({ project: { tag: "omms_project_test", displayName: "test" } }),
}));
mock.module("../src/services/client.js", () => ({
  memoryClient: {
    listMemories: async () => ({ success: true, memories: [] }),
    addMemory: async () => addMemoryResult,
  },
}));
mock.module("../src/core/capture-context.js", () => ({
  buildMarkdownContext: () => "context",
  getAutoCaptureMarkdownBudget: (configuredBytes: number | undefined) => {
    budgetArgs.push(configuredBytes);
    return 1000;
  },
}));

const { captureConversation } = await import("../src/core/capture.js");
const { handleFinishedTurn } = await import("../src/core/turn-outputs.js");
const { getTraceDirectory, resetTraceStateForTests } =
  await import("../src/services/capture-diagnostics.js");

const workUnit = {
  host: "pi" as const,
  hostSessionId: "session-1",
  sourceType: "live-capture" as const,
  projectDirectory: "/tmp/project",
  userPrompt: "fix the bug",
  textResponses: ["done"],
  toolCalls: [],
};

function attempts() {
  return logged.filter((entry) => entry.message === "Capture attempt").map((entry) => entry.data);
}

let logDir: string;
let previousLogFile: string | undefined;

beforeEach(() => {
  logged.length = 0;
  budgetArgs.length = 0;
  delete config.autoCaptureMaxContextBytes;
  config.captureTrace = false;
  addMemoryResult = { success: true, id: "m1" };
  resetTraceStateForTests();
  logDir = mkdtempSync(join(tmpdir(), "omms-pipeline-"));
  previousLogFile = process.env.OMMS_LOG_FILE;
  process.env.OMMS_LOG_FILE = join(logDir, "omms.log");
});

afterEach(() => {
  if (previousLogFile === undefined) delete process.env.OMMS_LOG_FILE;
  else process.env.OMMS_LOG_FILE = previousLogFile;
  rmSync(logDir, { recursive: true, force: true });
});

describe("capture pipeline diagnostics", () => {
  it("passes the current autoCaptureMaxContextBytes to the budget on every attempt", async () => {
    const summarize = async () => ({ summary: "", type: "skip", tags: [] });
    config.autoCaptureMaxContextBytes = 65536;
    await captureConversation(workUnit, { summarize });
    config.autoCaptureMaxContextBytes = 32768;
    await captureConversation(workUnit, { summarize });
    expect(budgetArgs).toEqual([65536, 32768]);
  });

  it("emits one saved record", async () => {
    const result = await captureConversation(workUnit, {
      summarize: async (request) => {
        Object.assign(request.diagnostics ?? {}, { provider: "zai", model: "glm-5.3" });
        return { summary: "Fixed it", type: "bug-fix", tags: [] };
      },
    });
    expect(result.status).toBe("captured");
    expect(attempts()).toEqual([
      expect.objectContaining({ outcome: "saved", provider: "zai", reason: null, host: "pi" }),
    ]);
  });

  it("emits one skipped record", async () => {
    await captureConversation(workUnit, {
      summarize: async () => ({ summary: "", type: "skip", tags: [] }),
    });
    expect(attempts()).toEqual([expect.objectContaining({ outcome: "skipped", reason: null })]);
  });

  it("emits one failed record with the provider's reason", async () => {
    await expect(
      captureConversation(workUnit, {
        summarize: async (request) => {
          if (request.diagnostics) request.diagnostics.failureReason = "empty-text";
          throw new Error("omms: Pi extraction returned an invalid summary payload");
        },
      })
    ).rejects.toThrow("Summary generation failed");
    expect(attempts()).toEqual([
      expect.objectContaining({ outcome: "failed", reason: "empty-text" }),
    ]);
  });

  it("reports a thrown call without a reason as call-error", async () => {
    await expect(
      captureConversation(workUnit, {
        summarize: async () => {
          throw new Error("network down");
        },
      })
    ).rejects.toThrow();
    expect(attempts()).toEqual([expect.objectContaining({ reason: "call-error" })]);
  });

  it("reports a storage failure as persist-error", async () => {
    addMemoryResult = { success: false, error: "disk full" };
    await expect(
      captureConversation(workUnit, {
        summarize: async () => ({ summary: "Fixed it", type: "bug-fix", tags: [] }),
      })
    ).rejects.toThrow("Memory persistence failed");
    expect(attempts()).toEqual([expect.objectContaining({ reason: "persist-error" })]);
  });

  it("writes one record per attempt when a failed unit is retried", async () => {
    let calls = 0;
    const provider = {
      summarize: async () => {
        calls++;
        if (calls === 1) throw new Error("network down");
        return { summary: "Fixed it", type: "bug-fix", tags: [] };
      },
    };
    // The live-capture and import retry loops call captureConversation once per attempt.
    await expect(captureConversation(workUnit, provider)).rejects.toThrow();
    await captureConversation(workUnit, provider);
    expect(attempts()).toEqual([
      expect.objectContaining({ outcome: "failed", reason: "call-error" }),
      expect.objectContaining({ outcome: "saved", reason: null }),
    ]);
  });

  it("refreshes the caller's config module and reads its CONFIG after the refresh", async () => {
    // The refresh replaces the module's CONFIG object, as a reload or space switch does.
    const configModule = {
      CONFIG: { autoCaptureMaxContextBytes: 1, captureTrace: false } as Record<string, unknown>,
      refreshed: [] as string[],
      refreshConfigIfChanged(directory: string) {
        configModule.refreshed.push(directory);
        configModule.CONFIG = { autoCaptureMaxContextBytes: 4096, captureTrace: true };
      },
    };
    const provider = {
      summarize: async () => ({ summary: "Fixed it", type: "bug-fix", tags: [] }),
    };
    await captureConversation(
      workUnit,
      provider,
      configModule as unknown as Parameters<typeof captureConversation>[2]
    );
    expect(configModule.refreshed).toEqual(["/tmp/project"]);
    expect(budgetArgs).toEqual([4096]);
    expect(existsSync(getTraceDirectory())).toBe(true);
  });

  it("passes the caller's config module from handleFinishedTurn to the capture", async () => {
    const configModule = {
      CONFIG: { autoCaptureMaxContextBytes: 2048 },
      refreshConfigIfChanged: () => {},
    };
    await handleFinishedTurn(
      workUnit,
      { memories: true, skills: false },
      {
        provider: { summarize: async () => ({ summary: "", type: "skip", tags: [] }) },
        configModule: configModule as unknown as Parameters<typeof captureConversation>[2],
      }
    );
    expect(budgetArgs).toEqual([2048]);
  });

  it("writes a trace only when tracing is on", async () => {
    const provider = {
      summarize: async () => ({ summary: "Fixed it", type: "bug-fix", tags: [] }),
    };
    await captureConversation(workUnit, provider);
    expect(existsSync(getTraceDirectory())).toBe(false);

    config.captureTrace = true;
    await captureConversation(workUnit, provider);
    expect(existsSync(getTraceDirectory())).toBe(true);
  });
});
