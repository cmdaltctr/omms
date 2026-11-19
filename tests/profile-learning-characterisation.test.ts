import { beforeEach, describe, expect, it, mock } from "bun:test";
import { buildCategoryList } from "../src/core/extraction.js";

// Characterisation of the live profile learning behaviour that stays when the three host
// loops become one shared pass (OpenSpec change unify-profile-learning, task 1.3). Every
// test passes on the code before the change and must pass again after it, with the same
// assertions. Only the `drive` helper below may change: it calls each host's entry point.
//
// Hosts: OpenCode `performUserProfileLearning`, Claude Code `learnClaudeProfile`, Pi
// `performPiProfileLearning`. The stores and the models are fakes; the config is the real
// CONFIG object with fields set per test. No `mock.module` of `config.js`.
//
// Mutations used to prove each test can fail (one line each, then reverted):
//  1. Reply schema check (Pi, Claude Code): src/core/profile-analysis.ts
//     `if (!parsed.success) {` -> `if (false) {`.
//  2. UTF-8 byte cut and marker (OpenCode): the `truncateToMaxBytes(s, maxBytes, ...)` call in
//     src/adapters/opencode/profile-learning.ts, `maxBytes` -> `maxBytes * 2`. After the
//     move, the same line in src/core/profile-learning/model-input.ts.
//  3. Three save attempts: src/services/user-profile/merge-and-save.ts
//     `MAX_PROFILE_SAVE_ATTEMPTS = 3` -> `= 4` (Pi, Claude Code); the OpenCode loop
//     `const MAX_RETRIES = 2;` -> `= 3`.
//  4. Newest-first batch: `recentFirst: true,` -> `recentFirst: false,` in
//     src/adapters/opencode/profile-learning.ts and in src/importer/claude-profile-learning.ts.
//  5. Trivial prompts skipped: remove `await userPromptManager.skipTrivialPromptsForLearning();`
//     from the same two files (replace with `void 0;`).
//  6. Cleanup when the interval is crossed: src/services/user-profile/auto-cleanup-trigger.ts
//     `<` -> `>` in the `Math.floor(previous / every) < ...` comparison.
//  7. Category list in the system prompt (Pi, Claude Code): src/core/profile-analysis.ts
//     `${existingData ? buildCategoryList(existingData) : ""}` -> `""`.
//     In the OpenCode input: `const catSection = buildCategoryList(profileData);` ->
//     `const catSection = "";` in src/adapters/opencode/profile-learning.ts
//     (after the move, in src/core/profile-learning/model-input.ts).
//  8. The 10-minute wait: src/core/profile-backoff.ts
//     `PROFILE_FAILURE_WAIT_MS = 10 * 60 * 1000` -> `5 * 60 * 1000`.
//
// Not covered here, by design: these tests pinned behaviour before Pi recorded its prompts in
// the store, so newest-first and trivial-prompt skipping are checked for OpenCode and Claude Code.
// The shared pass now applies them to Pi too (tests/profile-learning-pass.test.ts).

type HostName = "opencode" | "claude-code" | "pi";

const emptyData = { preferences: [], patterns: [], workflows: [] };
const withCategories = {
  preferences: [
    {
      category: "Code style",
      description: "Prefers small functions",
      confidence: 0.6,
      evidence: [],
    },
    {
      category: "Communication",
      description: "Wants short answers",
      confidence: 0.6,
      evidence: [],
    },
  ],
  patterns: [{ category: "Testing", description: "Writes tests first" }],
  workflows: [],
};

interface StoredPrompt {
  id: string;
  content: string;
  createdAt: number;
}

const world = {
  waiting: [] as StoredPrompt[],
  learned: new Set<string>(),
  profile: null as { id: string; data: unknown; total: number } | null,
  reads: 0,
  saves: [] as number[],
  created: [] as unknown[],
  acceptSave: (_attempt: number): boolean => true,
  modelCalls: 0,
  systemPrompts: [] as string[],
  userInputs: [] as string[],
  modelReply: (): unknown => emptyData,
  modelError: null as Error | null,
  cleanupStarted: [] as string[],
  logs: [] as Array<{ message: string; data: Record<string, unknown> | null }>,
};

mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: Record<string, unknown>) =>
    world.logs.push({ message, data: data ?? null }),
}));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({
    user: { userEmail: "me@example.invalid", displayName: "Me", userName: "me", tag: "t" },
  }),
}));
mock.module("../src/services/user-prompt/profile-catch-up-lease.js", () => ({
  CatchUpLease: class {
    async isActive() {
      return false;
    }
  },
}));
mock.module("../src/services/user-profile/auto-cleanup.js", () => ({
  startAutoProfileCleanup: (userId: string) => {
    world.cleanupStarted.push(userId);
    return new Promise(() => {});
  },
}));

const unlearned = () => world.waiting.filter((prompt) => !world.learned.has(prompt.id));
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    // The real store marks waiting trivial prompts as learned; the fake does the same.
    skipTrivialPromptsForLearning: async () => {
      let skipped = 0;
      const { isTrivialPrompt } = await import("../src/core/trivial-prompt.js");
      for (const prompt of unlearned()) {
        if (isTrivialPrompt(prompt.content)) {
          world.learned.add(prompt.id);
          skipped++;
        }
      }
      return skipped;
    },
    countUnanalyzedForUserLearning: async () => unlearned().length,
    // Oldest first, or the newest `limit` when `recentFirst` is set; a batch is chronological.
    getPromptsForUserLearning: async (limit: number, options: { recentFirst?: boolean } = {}) => {
      const sorted = [...unlearned()].sort((a, b) => a.createdAt - b.createdAt);
      const batch = options.recentFirst ? sorted.slice(-limit) : sorted.slice(0, limit);
      return batch.map((prompt) => ({ ...prompt, content: prompt.content }));
    },
    markMultipleAsUserLearningCaptured: async (ids: string[]) => {
      for (const id of ids) world.learned.add(id);
    },
    markForUserLearning: async () => {},
  },
}));

const freshProfile = () => {
  const stored = world.profile;
  if (!stored) return null;
  // Every read finds a newer version, as if another writer saved in between.
  return {
    id: stored.id,
    version: 7 + world.reads++,
    profileData: JSON.stringify(stored.data),
    totalPromptsAnalyzed: stored.total,
  };
};
mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    getActiveProfile: async () => freshProfile(),
    getProfileById: async () => freshProfile(),
    createProfile: async (...args: unknown[]) => {
      world.created.push(args);
      return "p1";
    },
    mergeProfileData: async () => emptyData,
    updateProfile: async (
      _id: string,
      _data: unknown,
      _count: number,
      _summary: string,
      expectedVersion: number
    ) => {
      world.saves.push(expectedVersion);
      return world.acceptSave(world.saves.length);
    },
    decayInMemory: (data: unknown) => ({ data }),
    syncConfidence: () => {},
  },
}));

mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  loadOpencodeProvider: async () => ({
    generateStructuredOutput: async (request: { systemPrompt: string; userPrompt: string }) => {
      world.modelCalls++;
      world.systemPrompts.push(request.systemPrompt);
      world.userInputs.push(request.userPrompt);
      if (world.modelError) throw world.modelError;
      return world.modelReply();
    },
  }),
}));
mock.module("../src/adapters/opencode/profile-llm-client.js", () => ({
  getOpencodeProfileHost: async () => ({}),
}));

const { CONFIG } = await import("../src/config.js");
const { profileBackoff, PROFILE_FAILURE_WAIT_MS } = await import("../src/core/profile-backoff.js");
const { performUserProfileLearning } = await import("../src/adapters/opencode/profile-learning.js");
const { learnClaudeProfile } = await import("../src/importer/claude-profile-learning.js");
const { learnPiProfile } = await import("../src/adapters/pi/profile.js");

/** The model every host calls: `complete` for Claude Code and Pi, structured output for OpenCode. */
const fakeModel = {
  provider: "stub",
  modelId: "stub",
  async complete(system: string, input: string) {
    world.modelCalls++;
    world.systemPrompts.push(system);
    world.userInputs.push(input);
    if (world.modelError) throw world.modelError;
    return JSON.stringify(world.modelReply());
  },
};

const fivePrompts = Array.from(
  { length: 5 },
  (_, i) => `Please refactor module number ${i} of the settings page`
);

/** Run one live pass on `host` over `prompts`. A rethrown host error is swallowed here. */
async function drive(host: HostName, prompts: string[] = fivePrompts): Promise<void> {
  world.waiting = world.waiting.length
    ? world.waiting
    : prompts.map((content, index) => ({ id: `p${index}`, content, createdAt: index + 1 }));
  try {
    if (host === "opencode") await performUserProfileLearning("/workspace");
    else if (host === "claude-code")
      await learnClaudeProfile("/workspace", () => fakeModel as never);
    else {
      // Pi records its prompts in the store and learns through the shared pass.
      await learnPiProfile({ directory: "/workspace", model: () => fakeModel as never });
    }
  } catch {
    // OpenCode rethrows a failed pass today; the shared pass returns it. Both leave the same state.
  }
}

/** The model input of the last call, whichever host made it. */
const lastInput = () => world.userInputs.at(-1) ?? "";

beforeEach(() => {
  world.waiting = [];
  world.learned = new Set();
  world.profile = { id: "p1", data: emptyData, total: 0 };
  world.reads = 0;
  world.saves = [];
  world.created = [];
  world.acceptSave = () => true;
  world.modelCalls = 0;
  world.systemPrompts = [];
  world.userInputs = [];
  world.modelReply = () => emptyData;
  world.modelError = null;
  world.cleanupStarted = [];
  world.logs = [];
  Object.assign(CONFIG, {
    autoCaptureProviderStatus: { ready: true, mode: "opencode", issues: [] },
    opencodeProvider: "opencode-go",
    opencodeModel: "deepseek-v4-flash",
    userProfileAnalysisInterval: 5,
    userProfileMaxContextBytes: 32768,
    userProfileValidationEnabled: false,
    showUserProfileToasts: false,
    showErrorToasts: false,
    userProfileAutoCleanupEnabled: true,
    userProfileAutoCleanupInterval: 100,
  });
  profileBackoff.recordSuccess();
});

const hosts: HostName[] = ["opencode", "claude-code", "pi"];
const storeHosts: HostName[] = ["opencode", "claude-code"];

describe("the reply schema check (Pi, Claude Code)", () => {
  it.each(["pi", "claude-code"] as const)(
    "%s: a reply that fails the profile schema saves nothing and starts the wait",
    async (host) => {
      world.modelReply = () => ({ preferences: "nope" });
      await drive(host);
      expect(world.saves).toEqual([]);
      expect(world.created).toEqual([]);
      expect(world.learned.size).toBe(0);
      expect(
        world.logs.some(
          (entry) => entry.data?.host === host && entry.data?.reason === "invalid-reply"
        )
      ).toBe(true);
      expect(profileBackoff.canRun()).toBe(false);
    }
  );

  it.each(["pi", "claude-code"] as const)("%s: a valid reply is saved", async (host) => {
    await drive(host);
    expect(world.saves).toHaveLength(1);
    expect(world.modelCalls).toBe(1);
  });
});

describe("the UTF-8 byte cut and marker (OpenCode)", () => {
  const MARKER = "[... context truncated to userProfileMaxContextBytes ...]";
  /** A lone high or low surrogate: a multi-byte character split at the cut. */
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const multibyte = (index: number) =>
    `${index}. 用户偏好简体中文回复并且遵循项目的中文注释规范 ` +
    "يفضّل المستخدم الرد بالعربية في التوثيق " +
    "🚀🎉✨🚀🎉✨";

  async function run(maxBytes: number, prompts: string[]): Promise<string> {
    CONFIG.userProfileMaxContextBytes = maxBytes;
    CONFIG.userProfileAnalysisInterval = prompts.length;
    world.profile = null;
    world.waiting = prompts.map((content, index) => ({
      id: `p${index}`,
      content,
      createdAt: index + 1,
    }));
    await drive("opencode");
    return lastInput();
  }

  it("bounds multibyte input by UTF-8 bytes even when the character count fits", async () => {
    const input = await run(
      5000,
      Array.from({ length: 20 }, (_, i) => multibyte(i + 1))
    );
    expect(input).not.toBe("");
    expect(Buffer.byteLength(input, "utf8")).toBeLessThanOrEqual(5000);
  });

  it("keeps the truncation marker inside the ceiling and never splits a character", async () => {
    const input = await run(4096, [
      `1. ${"🚀".repeat(2000)}`,
      ...Array.from({ length: 12 }, (_, i) => multibyte(i + 2)),
    ]);
    expect(input).toContain(MARKER);
    expect(Buffer.byteLength(input, "utf8")).toBeLessThanOrEqual(4096);
    expect(input).not.toMatch(LONE_SURROGATE);
    expect(input).not.toContain("�");
  });

  it("leaves input that already fits unchanged", async () => {
    const input = await run(32768, [
      "Fix the login timeout",
      "Use British spelling in docs",
      "Prefer bun over npm",
      "Keep answers short",
      "Run the tests first",
    ]);
    expect(input).not.toContain(MARKER);
    expect(input).toContain("Prefer bun over npm");
  });
});

describe("three save attempts and no second model call (all hosts)", () => {
  it.each(hosts)("%s: three conflicts make three saves and one model call", async (host) => {
    world.acceptSave = () => false;
    await drive(host);
    expect(world.saves).toHaveLength(3);
    expect(world.modelCalls).toBe(1);
    expect(world.created).toEqual([]);
  });

  it.each(storeHosts)("%s: three conflicts leave the prompts waiting", async (host) => {
    world.acceptSave = () => false;
    await drive(host);
    expect(world.learned.size).toBe(0);
  });

  it.each(hosts)(
    "%s: a second attempt that lands saves twice and calls the model once",
    async (host) => {
      world.acceptSave = (attempt) => attempt >= 2;
      await drive(host);
      expect(world.saves).toHaveLength(2);
      expect(world.modelCalls).toBe(1);
      if (host !== "pi") expect(world.learned.size).toBe(5);
    }
  );
});

describe("the batch is the newest prompts (OpenCode, Claude Code)", () => {
  it.each(storeHosts)("%s: 15 waiting prompts, a batch of 5 takes the newest", async (host) => {
    world.waiting = Array.from({ length: 15 }, (_, i) => ({
      id: `p${i}`,
      content: `Prompt number ${String(i).padStart(2, "0")} about the project`,
      createdAt: i + 1,
    }));
    await drive(host);
    expect(lastInput()).toContain("Prompt number 14 about the project");
    expect(lastInput()).toContain("Prompt number 10 about the project");
    expect(lastInput()).not.toContain("Prompt number 09 about the project");
    expect(lastInput()).not.toContain("Prompt number 00 about the project");
    expect([...world.learned].sort()).toEqual(["p10", "p11", "p12", "p13", "p14"]);
  });
});

describe("trivial prompts are skipped (OpenCode, Claude Code)", () => {
  it.each(storeHosts)("%s: a trivial reply is marked learned and never sent", async (host) => {
    world.waiting = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `p${i}`,
        content: `Please refactor module number ${i} of the settings page`,
        createdAt: i + 1,
      })),
      { id: "trivial", content: "ok", createdAt: 99 },
    ];
    await drive(host);
    expect(world.learned.has("trivial")).toBe(true);
    expect(world.modelCalls).toBe(1);
    expect(lastInput()).not.toMatch(/^\d+\. ok$/m);
    expect(lastInput()).toContain("refactor module number 4");
  });
});

describe("the automatic cleanup starts when the interval is crossed (all hosts)", () => {
  it.each(hosts)("%s: 95 analysed plus 5 crosses 100 and starts one run", async (host) => {
    world.profile = { id: "p1", data: emptyData, total: 95 };
    await drive(host);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(world.saves).toHaveLength(1);
    expect(world.cleanupStarted).toEqual(["me@example.invalid"]);
  });

  it.each(hosts)("%s: 90 analysed plus 5 starts none", async (host) => {
    world.profile = { id: "p1", data: emptyData, total: 90 };
    await drive(host);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(world.saves).toHaveLength(1);
    expect(world.cleanupStarted).toEqual([]);
  });
});

describe("the category list in the prompt", () => {
  it.each(["pi", "claude-code"] as const)(
    "%s: the system prompt lists the existing categories",
    async (host) => {
      world.profile = { id: "p1", data: withCategories, total: 5 };
      await drive(host);
      expect(world.systemPrompts.at(-1)).toContain("## Existing Categories");
      expect(world.systemPrompts.at(-1)).toContain(buildCategoryList(withCategories));
    }
  );

  it.each(["pi", "claude-code"] as const)(
    "%s: the first profile analysis has no category list",
    async (host) => {
      world.profile = null;
      await drive(host);
      expect(world.systemPrompts.at(-1)).not.toContain("## Existing Categories");
    }
  );

  it("opencode: the model input lists the same categories", async () => {
    world.profile = { id: "p1", data: withCategories, total: 5 };
    await drive("opencode");
    expect(lastInput()).toContain(buildCategoryList(withCategories));
  });
});

describe("the 10-minute wait after a failed pass (all hosts)", () => {
  it.each(hosts)("%s: a failed pass blocks the next pass for 10 minutes", async (host) => {
    world.modelError = new Error("API request timeout (30000ms)");
    await drive(host);
    expect(world.modelCalls).toBe(1);
    await drive(host);
    expect(world.modelCalls).toBe(1);
    expect(profileBackoff.canRun(Date.now() + PROFILE_FAILURE_WAIT_MS - 5000)).toBe(false);
    expect(profileBackoff.canRun(Date.now() + PROFILE_FAILURE_WAIT_MS + 5000)).toBe(true);
    expect(PROFILE_FAILURE_WAIT_MS).toBe(10 * 60 * 1000);
  });

  it.each(storeHosts)("%s: three save conflicts start the wait", async (host) => {
    world.acceptSave = () => false;
    await drive(host);
    expect(profileBackoff.canRun()).toBe(false);
    expect(profileBackoff.canRun(Date.now() + PROFILE_FAILURE_WAIT_MS + 5000)).toBe(true);
  });
});
