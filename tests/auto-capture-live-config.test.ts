import { beforeEach, describe, expect, it, mock } from "bun:test";
// OpenCode auto-capture reads the host's config module on each use, so a
// reload or space switch (which replaces `CONFIG`) applies from the next read.

let addCalls = 0;
const prompts: Array<Record<string, unknown>> = [];
const drained: Array<Record<string, unknown>> = [];
mock.module("../src/services/logger.js", () => ({ log: () => {} }));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({ project: { tag: "omms_project_test", displayName: "test" } }),
}));
mock.module("../src/services/client.js", () => ({
  memoryClient: {
    listMemories: async () => ({ success: true, memories: [] }),
    addMemory: async () => ({ success: true, id: `m${++addCalls}` }),
  },
}));
mock.module("../src/services/capture-attempt-store.js", () => ({
  saveCaptureAttempt: async () => {},
}));
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    getUncapturedPromptsForSession: async () => prompts.filter((p) => !p.done),
    claimPrompt: async () => true,
    deletePrompt: async () => {},
    markAsCaptured: async (id: string) => {
      const found = prompts.find((p) => p.id === id);
      if (found) found.done = true;
    },
    linkMemoryToPrompt: async () => {},
    recordFailedAttempt: async () => {},
    releaseClaim: async () => true,
  },
}));
mock.module("../src/services/capture-retry-drain.js", () => ({
  queueFailedCapture: async () => false,
  startCaptureRetryDrain: () => {},
  drainCaptureRetries: async (options: Record<string, unknown>) => {
    drained.push(options);
    return {};
  },
}));

const { performAutoCapture, drainOpencodeCaptureRetries } =
  await import("../src/services/auto-capture.js");
type ConfigModule = Parameters<typeof performAutoCapture>[3];

let summarizeCalls = 0;
const notifications: string[] = [];
const host = {
  host: "opencode" as const,
  isCaptureReady: () => true,
  getConversation: async () => ({ textResponses: ["Done"], toolCalls: [] }),
  summarize: async () => {
    summarizeCalls++;
    return { summary: "Fixed it", type: "bug-fix", tags: [] };
  },
  notify: async (notification: { title: string }) => {
    notifications.push(notification.title);
  },
};

function configModule(config: Record<string, unknown>, onRefresh?: () => void) {
  const module = {
    CONFIG: { autoCaptureMaxRetries: 1, showErrorToasts: false, ...config },
    refreshConfigIfChanged: () => onRefresh?.(),
  };
  return module;
}

beforeEach(() => {
  prompts.length = 0;
  drained.length = 0;
  notifications.length = 0;
  addCalls = 0;
  summarizeCalls = 0;
  prompts.push({ id: "p1", messageId: "m1", content: "fix the bug", createdAt: 1 });
});

describe("auto-capture reads the live config module", () => {
  it("uses the CONFIG the module holds at each call", async () => {
    const module = configModule({ autoCaptureEnabled: false });
    await performAutoCapture(host, "ses-1", "/tmp/project", module as unknown as ConfigModule);
    expect(summarizeCalls).toBe(0);

    // A reload replaces the object, as `config.ts` does.
    module.CONFIG = { ...module.CONFIG, autoCaptureEnabled: true };
    await performAutoCapture(host, "ses-1", "/tmp/project", module as unknown as ConfigModule);
    expect(summarizeCalls).toBe(1);
    expect(addCalls).toBe(1);
  });

  it("reads the toast switch after the capture's refresh", async () => {
    const module = configModule({ autoCaptureEnabled: true, showAutoCaptureToasts: true }, () => {
      module.CONFIG = { ...module.CONFIG, showAutoCaptureToasts: false };
    });
    await performAutoCapture(host, "ses-1", "/tmp/project", module as unknown as ConfigModule);
    expect(addCalls).toBe(1);
    expect(notifications).toEqual([]);
  });

  it("drains with the CONFIG loaded by the refresh", async () => {
    const reloaded = { captureRetryRetentionHours: 12 };
    const module = {
      CONFIG: { captureRetryRetentionHours: 72 },
      refreshConfigIfChanged: () => {
        module.CONFIG = reloaded;
      },
    };
    await drainOpencodeCaptureRetries(host, "/tmp/project", module as unknown as ConfigModule);
    expect(drained).toHaveLength(1);
    expect(drained[0]?.config).toBe(reloaded);
    expect(drained[0]?.configModule).toBe(module);
  });
});
