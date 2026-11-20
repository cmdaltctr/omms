import { beforeEach, describe, expect, it, mock } from "bun:test";

// Tests for the behaviour that changes in OpenSpec change unify-profile-learning (task 2.1).
// They drive the shared pass, `runProfileLearningPass` in src/core/profile-learning/pass.ts,
// which does not exist yet. Until it does, every test fails with "Cannot find module". The
// stores are fakes and the config is passed in, so there is no `mock.module` of `config.js`.
//
// Interface assumed (design D1 to D5, simplest reading where the design is open):
//  - `runProfileLearningPass(input)` in src/core/profile-learning/pass.ts, input =
//    { host, directory, config, model, notify }, returns { outcome: "saved" | "skipped" |
//    "failed", reason? } and never throws. `startCleanup` is not used here (see the report).
//  - `config` holds: userProfileAnalysisInterval, userProfileMaxContextBytes,
//    userProfileWithoutEmail, userProfileDecayBeforeMerge, userProfilePromptDetail,
//    userProfileValidationEnabled, showUserProfileToasts, userProfileDuringCatchUp,
//    userProfileAutoCleanupEnabled, userProfileAutoCleanupInterval.
//  - The pass reads the waiting prompts from the shared prompt store (userPromptManager:
//    skipTrivialPromptsForLearning, countUnanalyzedForUserLearning,
//    getPromptsForUserLearning, markMultipleAsUserLearningCaptured) for every host, Pi
//    included. It reads and saves the profile through userProfileManager (getActiveProfile,
//    getProfileById, createProfile, mergeProfileData, updateProfile, decayInMemory,
//    syncConfidence). Both modules are replaced with `mock.module`, so the pass may also take
//    them through a `deps` argument with these modules as the default.
//  - Decay is `userProfileManager.decayInMemory`, called once before the analysis and once
//    before each save retry, only when userProfileDecayBeforeMerge is true.
//  - The git or override email comes from `getTags(directory).user.userEmail`.
//  - A catch-up run is seen through `profileCatchUpLock.isActive()` (this process) and
//    `new CatchUpLease().isActive()` (any process), as the Claude Code loop reads them today.
//  - `withExternalFallback(host, primary, external, notify)` in
//    src/core/profile-learning/fallback.ts takes ModelPort | null for `primary` and
//    `external`, and returns a ModelPort. `notify` has the same shape as the pass notify.
//  - A prompts-only model input has no "## " heading and one "N. text" line per prompt. Both
//    input modes end in the same truncation marker as today when they are cut.

type HostName = "pi" | "opencode" | "claude-code";
const hosts: HostName[] = ["pi", "opencode", "claude-code"];
const label: Record<HostName, string> = {
  pi: "Pi",
  opencode: "OpenCode",
  "claude-code": "Claude Code",
};

const DAY = 86_400_000;
const empty = { preferences: [], patterns: [], workflows: [] };
const preferences = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    category: "Code style",
    description: `Preference number ${i} about code style`,
    confidence: 0.9 - i * 0.05,
    evidence: [],
    alpha: 4,
    beta: 1,
    frequency: 2,
    lastSeen: Date.now() - 40 * DAY,
  }));
const profileData = (count: number) => ({ ...empty, preferences: preferences(count) });

interface Notice {
  title: string;
  message: string;
  variant: string;
}

const world = {
  email: "me@example.invalid" as string | null,
  waiting: [] as Array<{ id: string; content: string; createdAt: number }>,
  learned: new Set<string>(),
  profile: null as { id: string; data: unknown; total: number } | null,
  saves: [] as Array<{ data: unknown; count: number; summary: string; version: number }>,
  created: [] as unknown[][],
  merged: [] as unknown[],
  acceptSave: (_attempt: number): boolean => true,
  decays: 0,
  leaseActive: false,
  claimOptions: [] as unknown[],
  released: [] as string[][],
  modelCalls: 0,
  structuredCalls: 0,
  inputs: [] as string[],
  reply: (): unknown => empty,
  modelError: null as Error | null,
  markFailures: 0,
  // Prompt ids the fake profile save recorded with the profile (the learned-prompt record).
  ledger: new Set<string>(),
  notices: [] as Notice[],
  logs: [] as Array<{ message: string; data: Record<string, unknown> | null; level?: string }>,
};

mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: Record<string, unknown>, level?: string) =>
    world.logs.push({ message, data: data ?? null, level }),
}));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({
    user: {
      userEmail: world.email ?? undefined,
      displayName: "Me",
      userName: "me",
      tag: "t",
    },
  }),
}));
mock.module("../src/services/user-prompt/profile-catch-up-lease.js", () => ({
  CatchUpLease: class {
    async isActive() {
      return world.leaseActive;
    }
  },
}));
mock.module("../src/services/user-profile/auto-cleanup.js", () => ({
  startAutoProfileCleanup: () => new Promise(() => {}),
}));

const unlearned = () => world.waiting.filter((prompt) => !world.learned.has(prompt.id));
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => unlearned().length,
    getPromptsForUserLearning: async (limit: number, options: { recentFirst?: boolean } = {}) => {
      world.claimOptions.push(options);
      const sorted = [...unlearned()].sort((a, b) => a.createdAt - b.createdAt);
      return options.recentFirst ? sorted.slice(-limit) : sorted.slice(0, limit);
    },
    markMultipleAsUserLearningCaptured: async (ids: string[]) => {
      if (world.markFailures > 0) {
        world.markFailures--;
        throw new Error("database is locked");
      }
      for (const id of ids) world.learned.add(id);
    },
    markForUserLearning: async (ids: string[]) => {
      world.released.push(ids);
    },
  },
}));

let reads = 0;
const freshProfile = () => {
  const stored = world.profile;
  if (!stored) return null;
  return {
    id: stored.id,
    version: 7 + reads++,
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
      for (const id of (args[6] as string[] | undefined) ?? []) world.ledger.add(id);
      return "p1";
    },
    // An identity merge: the saved data then shows exactly what the pass did to the stored data.
    mergeProfileData: async (existing: unknown) => {
      world.merged.push(existing);
      return existing;
    },
    updateProfile: async (
      _id: string,
      data: unknown,
      count: number,
      summary: string,
      version: number,
      learned: string[] = []
    ) => {
      world.saves.push({ data, count, summary, version });
      const accepted = world.acceptSave(world.saves.length);
      if (accepted) for (const id of learned) world.ledger.add(id);
      return accepted;
    },
    getLearnedPromptIds: async (_profileId: string, ids: string[]) =>
      ids.filter((id) => world.ledger.has(id)),
    clearLearnedPromptIds: async (_profileId: string, ids: string[]) => {
      for (const id of ids) world.ledger.delete(id);
    },
    decayInMemory: (data: unknown) => {
      world.decays++;
      return { data };
    },
    syncConfidence: () => {},
    evolveAndUpdate: async () => {},
  },
}));

const { profileBackoff, profileCatchUpLock } = await import("../src/core/profile-backoff.js");

/** A model port with `complete`; `structured` adds `completeStructured` that the pass should prefer. */
function makePort(structured = false) {
  const port: Record<string, unknown> = {
    provider: "stub",
    modelId: "stub",
    async complete(_system: string, input: string) {
      world.modelCalls++;
      world.inputs.push(input);
      if (world.modelError) throw world.modelError;
      return JSON.stringify(world.reply());
    },
  };
  if (structured) {
    port.completeStructured = async (_system: string, input: string) => {
      world.structuredCalls++;
      world.inputs.push(input);
      if (world.modelError) throw world.modelError;
      return world.reply();
    };
  }
  return port;
}

const baseConfig = {
  userProfileAnalysisInterval: 5,
  userProfileMaxContextBytes: 32768,
  userProfileWithoutEmail: "learn",
  userProfileDecayBeforeMerge: false,
  userProfilePromptDetail: "full",
  userProfileValidationEnabled: false,
  showUserProfileToasts: true,
  userProfileDuringCatchUp: "learn",
  userProfileAutoCleanupEnabled: false,
  userProfileAutoCleanupInterval: 500,
};

async function loadPass() {
  return (await import("../src/core/profile-learning/pass.js")) as {
    runProfileLearningPass: (input: unknown) => Promise<{ outcome: string; reason?: string }>;
  };
}

async function run(
  host: HostName,
  options: {
    config?: Record<string, unknown>;
    model?: unknown;
    structured?: boolean;
    notify?: (notice: Notice) => void;
  } = {}
) {
  const { runProfileLearningPass } = await loadPass();
  const model = options.model === undefined ? makePort(options.structured) : options.model;
  return runProfileLearningPass({
    host,
    directory: "/workspace",
    config: { ...baseConfig, ...options.config },
    model: () => model,
    notify:
      options.notify ??
      ((notice: Notice) => {
        world.notices.push(notice);
      }),
  });
}

beforeEach(async () => {
  world.email = "me@example.invalid";
  world.waiting = Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`,
    content: `Please refactor module number ${i} of the settings page`,
    createdAt: i + 1,
  }));
  world.learned = new Set();
  world.profile = { id: "p1", data: profileData(8), total: 5 };
  world.saves = [];
  world.created = [];
  world.merged = [];
  world.acceptSave = () => true;
  world.decays = 0;
  world.claimOptions = [];
  world.released = [];
  world.leaseActive = false;
  world.modelCalls = 0;
  world.structuredCalls = 0;
  world.inputs = [];
  world.reply = () => empty;
  world.modelError = null;
  world.markFailures = 0;
  world.ledger = new Set();
  world.notices = [];
  world.logs = [];
  reads = 0;
  profileBackoff.recordSuccess();
  while (profileCatchUpLock.isActive()) profileCatchUpLock.end();
});

describe("no user email (user decision: learn without email)", () => {
  it.each(hosts)("%s: learns into the profile with the id unknown by default", async (host) => {
    world.email = null;
    world.profile = null;
    const result = await run(host);
    expect(result.outcome).toBe("saved");
    expect(world.modelCalls).toBe(1);
    expect(world.created).toHaveLength(1);
    expect(world.created[0]![0]).toBe("unknown");
    expect(world.learned.size).toBe(5);
  });

  it.each(hosts)("%s: skip makes no model call and leaves the prompts waiting", async (host) => {
    world.email = null;
    const result = await run(host, { config: { userProfileWithoutEmail: "skip" } });
    expect(result.outcome).toBe("skipped");
    expect(world.modelCalls).toBe(0);
    expect(world.learned.size).toBe(0);
    expect(
      world.logs.some((entry) => entry.level === "warn" && entry.data?.code === "no-user-email")
    ).toBe(true);
  });
});

describe("no decay before the merge by default", () => {
  it.each(hosts)("%s: the stored profile is not decayed", async (host) => {
    const result = await run(host);
    expect(result.outcome).toBe("saved");
    expect(world.decays).toBe(0);
    const stored = (world.merged[0] as { preferences: Array<{ confidence: number }> }).preferences;
    expect(stored[0]!.confidence).toBe(0.9);
  });

  it.each(hosts)("%s: the setting decays before the analysis and before a retry", async (host) => {
    world.acceptSave = (attempt) => attempt >= 2;
    const result = await run(host, { config: { userProfileDecayBeforeMerge: true } });
    expect(result.outcome).toBe("saved");
    expect(world.saves).toHaveLength(2);
    expect(world.decays).toBeGreaterThanOrEqual(2);
  });
});

describe("the model input", () => {
  it.each(hosts)("%s: the default is the full input", async (host) => {
    await run(host);
    const input = world.inputs[0]!;
    expect(input).toContain("## Recent Prompts");
    expect(input).toContain("## Analysis Guidelines");
    expect(input).toContain("## Few-Shot Examples");
    expect(input).toContain("## Profile Size");
    expect(input).toContain("Please refactor module number 4 of the settings page");
  });

  it.each(hosts)("%s: a first profile has the guidelines and no profile summary", async (host) => {
    world.profile = null;
    await run(host);
    const input = world.inputs[0]!;
    expect(input).toContain("## Analysis Guidelines");
    expect(input).toContain("## Few-Shot Examples");
    expect(input).not.toContain("## Profile Size");
    expect(input).not.toContain("## Existing Categories");
  });

  it.each(hosts)("%s: prompts-only sends only the numbered prompts", async (host) => {
    await run(host, { config: { userProfilePromptDetail: "prompts-only" } });
    const input = world.inputs[0]!;
    expect(input).not.toMatch(/^## /m);
    const lines = input.split("\n").filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("1. Please refactor module number 0 of the settings page");
    expect(lines[4]).toBe("5. Please refactor module number 4 of the settings page");
  });

  it.each(hosts)("%s: both modes are cut to the byte limit", async (host) => {
    world.waiting = world.waiting.map((prompt) => ({ ...prompt, content: "🚀".repeat(1000) }));
    for (const userProfilePromptDetail of ["full", "prompts-only"]) {
      world.inputs = [];
      world.learned = new Set();
      await run(host, { config: { userProfilePromptDetail, userProfileMaxContextBytes: 4096 } });
      expect(Buffer.byteLength(world.inputs[0]!, "utf8")).toBeLessThanOrEqual(4096);
      expect(world.inputs[0]).toContain(
        "[... context truncated to userProfileMaxContextBytes ...]"
      );
    }
  });

  it("two hosts send the same input and save the same profile for the same batch", async () => {
    const outcomes: Array<{ input: string; saved: unknown; count: number }> = [];
    for (const host of ["pi", "opencode"] as const) {
      world.inputs = [];
      world.saves = [];
      world.learned = new Set();
      reads = 0;
      await run(host);
      outcomes.push({
        input: world.inputs[0]!,
        saved: world.saves[0]!.data,
        count: world.saves[0]!.count,
      });
    }
    expect(outcomes[0]).toEqual(outcomes[1]!);
  });
});

describe("the check of older items", () => {
  const verdicts = {
    ...empty,
    validations: [{ index: 0, verdict: "confirmed", reason: "clear evidence" }],
  };

  it.each(hosts)(
    "%s: the setting adds the validation task and names the verdicts",
    async (host) => {
      world.reply = () => verdicts;
      const result = await run(host, { config: { userProfileValidationEnabled: true } });
      expect(result.outcome).toBe("saved");
      expect(world.inputs[0]).toContain("## Task 3: Validate Existing Profile Entries");
      expect(world.saves[0]!.summary).toBe(
        `${label[host]} analysis of 5 prompts; validated: 1 confirmed, 0 contradicted, 0 inaccurate, 0 oversimplified`
      );
    }
  );

  it.each(hosts)("%s: the default sends no validation task", async (host) => {
    await run(host);
    expect(world.inputs[0]).not.toContain("Validate Existing Profile Entries");
  });

  it.each(hosts)("%s: fewer than 5 preferences skip the check", async (host) => {
    world.profile = { id: "p1", data: profileData(3), total: 5 };
    await run(host, { config: { userProfileValidationEnabled: true } });
    expect(world.inputs[0]).not.toContain("Validate Existing Profile Entries");
    expect(world.saves[0]!.summary).toBe(`${label[host]} analysis of 5 prompts`);
  });
});

describe("the history text", () => {
  it.each(hosts)("%s: reads <Host> analysis of N prompts", async (host) => {
    await run(host);
    expect(world.saves).toHaveLength(1);
    expect(world.saves[0]!.summary).toBe(`${label[host]} analysis of 5 prompts`);
    expect(world.saves[0]!.count).toBe(5);
  });
});

describe("the notice", () => {
  it.each(hosts)("%s: a saved pass shows the same words", async (host) => {
    await run(host);
    expect(world.notices).toEqual([
      {
        title: "User profile updated",
        message: "Analysed 5 prompts and updated your profile",
        variant: "success",
      },
    ]);
  });

  it.each(hosts)("%s: notices off shows nothing", async (host) => {
    await run(host, { config: { showUserProfileToasts: false } });
    expect(world.saves).toHaveLength(1);
    expect(world.notices).toEqual([]);
  });

  it.each(hosts)("%s: a failed pass shows no success notice", async (host) => {
    world.modelError = new Error("API request timeout (30000ms)");
    await run(host);
    expect(world.notices.some((notice) => notice.variant === "success")).toBe(false);
  });

  // Pi's notice throws at once when its session was replaced or reloaded during the pass.
  it.each(hosts)("%s: a notice that throws at once keeps a saved pass saved", async (host) => {
    const result = await run(host, {
      notify: () => {
        throw new Error("This extension ctx is stale");
      },
    });
    expect(result).toEqual({ outcome: "saved" });
    expect(world.saves).toHaveLength(1);
    expect(world.released).toEqual([]);
    expect(profileBackoff.canRun()).toBe(true);
  });
});

describe("a failed host model falls back with a notice", () => {
  async function loadFallback() {
    return (await import("../src/core/profile-learning/fallback.js")) as {
      withExternalFallback: (
        host: HostName,
        primary: unknown,
        external: unknown,
        notify: (notice: Notice) => void
      ) => unknown;
    };
  }
  const failing = (message: string) => ({
    provider: "host",
    modelId: "host-model",
    async complete(): Promise<string> {
      throw new Error(message);
    },
  });

  it("OpenCode: a timeout uses the external API and shows the warning", async () => {
    const { withExternalFallback } = await loadFallback();
    const model = withExternalFallback(
      "opencode",
      failing("API request timeout (30000ms)"),
      makePort(),
      (notice) => {
        world.notices.push(notice);
      }
    );
    const result = await run("opencode", { model });
    expect(result.outcome).toBe("saved");
    expect(world.modelCalls).toBe(1);
    expect(world.notices[0]).toEqual({
      title: "Using fallback provider",
      message: "OpenCode model failed (API request timeout (30000ms)); using configured fallback.",
      variant: "warning",
    });
    expect(world.notices.at(-1)!.variant).toBe("success");
  });

  it("Pi: the same words with the Pi label", async () => {
    const { withExternalFallback } = await loadFallback();
    const model = withExternalFallback("pi", failing("model overloaded"), makePort(), (notice) => {
      world.notices.push(notice);
    });
    const result = await run("pi", { model });
    expect(result.outcome).toBe("saved");
    expect(world.notices[0]!.message).toBe(
      "Pi model failed (model overloaded); using configured fallback."
    );
  });

  it("Pi: a fallback notice that throws at once still reaches the external API", async () => {
    const { withExternalFallback } = await loadFallback();
    const model = withExternalFallback("pi", failing("model overloaded"), makePort(), () => {
      throw new Error("This extension ctx is stale");
    });
    const result = await run("pi", { model });
    expect(result.outcome).toBe("saved");
    expect(world.modelCalls).toBe(1);
  });

  it("Pi: no external API fails the pass with the host error and starts the wait", async () => {
    const { withExternalFallback } = await loadFallback();
    const model = withExternalFallback(
      "pi",
      failing("API request timeout (30000ms)"),
      null,
      (notice) => {
        world.notices.push(notice);
      }
    );
    const result = await run("pi", { model });
    expect(result).toEqual({ outcome: "failed", reason: "timeout" });
    expect(world.saves).toEqual([]);
    expect(world.notices.some((notice) => notice.variant === "warning")).toBe(false);
    expect(profileBackoff.canRun()).toBe(false);
  });
});

describe("bad host replies and stuck notices still reach the external API", () => {
  async function loadFallback() {
    return (await import("../src/core/profile-learning/fallback.js")) as {
      withExternalFallback: (
        host: HostName,
        primary: unknown,
        external: unknown,
        notify: (notice: Notice) => unknown
      ) => unknown;
    };
  }
  const textHost = (reply: string) => ({
    provider: "host",
    modelId: "host-model",
    async complete(): Promise<string> {
      return reply;
    },
  });
  const warnings = () => world.notices.filter((notice) => notice.variant === "warning");

  it.each(["pi", "opencode"] as const)(
    "%s: a host reply that is not JSON falls back to the external API",
    async (host) => {
      const { withExternalFallback } = await loadFallback();
      const model = withExternalFallback(
        host,
        textHost("Sorry, I cannot do that."),
        makePort(),
        (notice) => {
          world.notices.push(notice);
        }
      );
      const result = await run(host, { model });
      expect(result.outcome).toBe("saved");
      expect(world.modelCalls).toBe(1);
      expect(warnings()).toHaveLength(1);
    }
  );

  it("a host reply that fails the profile schema falls back too", async () => {
    const { withExternalFallback } = await loadFallback();
    const model = withExternalFallback(
      "pi",
      textHost('{"preferences":"nope"}'),
      makePort(),
      (notice) => {
        world.notices.push(notice);
      }
    );
    const result = await run("pi", { model });
    expect(result.outcome).toBe("saved");
    expect(world.modelCalls).toBe(1);
  });

  it("a bad external reply after the fallback still fails with invalid-reply", async () => {
    const { withExternalFallback } = await loadFallback();
    world.reply = () => ({ preferences: "nope" });
    const model = withExternalFallback("pi", textHost("not json"), makePort(), () => {});
    expect(await run("pi", { model })).toEqual({ outcome: "failed", reason: "invalid-reply" });
    expect(world.saves).toEqual([]);
  });

  it("a good host reply makes no external call and shows no warning", async () => {
    const { withExternalFallback } = await loadFallback();
    const model = withExternalFallback(
      "pi",
      textHost(JSON.stringify(empty)),
      makePort(),
      (notice) => {
        world.notices.push(notice);
      }
    );
    expect((await run("pi", { model })).outcome).toBe("saved");
    expect(world.modelCalls).toBe(0);
    expect(warnings()).toEqual([]);
  });

  it.each(["pi", "opencode"] as const)(
    "%s: a notice that never returns does not hold the external API",
    async (host) => {
      const { withExternalFallback } = await loadFallback();
      let shown = 0;
      const model = withExternalFallback(
        host,
        {
          provider: "host",
          modelId: "host-model",
          async complete(): Promise<string> {
            throw new Error("model overloaded");
          },
        },
        makePort(),
        () => {
          shown++;
          return new Promise(() => {});
        }
      );
      const result = await run(host, { model, notify: () => {} });
      expect(result.outcome).toBe("saved");
      expect(world.modelCalls).toBe(1);
      expect(shown).toBe(1);
    },
    3000
  );
});

describe("every reply is checked before the merge", () => {
  it.each(hosts)("%s: a malformed reply fails with invalid-reply", async (host) => {
    world.reply = () => ({ preferences: "nope" });
    const result = await run(host);
    expect(result).toEqual({ outcome: "failed", reason: "invalid-reply" });
    expect(world.saves).toEqual([]);
    expect(world.created).toEqual([]);
    expect(world.learned.size).toBe(0);
  });

  it("OpenCode: a malformed structured-output reply fails with invalid-reply", async () => {
    world.reply = () => ({ preferences: "nope" });
    const result = await run("opencode", { structured: true });
    expect(result).toEqual({ outcome: "failed", reason: "invalid-reply" });
    expect(world.structuredCalls).toBe(1);
    expect(world.saves).toEqual([]);
  });

  it("a model with structured output is called through it, not through complete", async () => {
    const result = await run("opencode", { structured: true });
    expect(result.outcome).toBe("saved");
    expect(world.structuredCalls).toBe(1);
    expect(world.modelCalls).toBe(0);
  });
});

describe("the wait after three save conflicts", () => {
  it.each(hosts)("%s: no model call for 10 minutes", async (host) => {
    world.acceptSave = () => false;
    const first = await run(host);
    expect(first.outcome).toBe("failed");
    expect(world.saves).toHaveLength(3);
    expect(world.modelCalls).toBe(1);
    expect(world.learned.size).toBe(0);
    const second = await run(host);
    expect(second.outcome).toBe("skipped");
    expect(world.modelCalls).toBe(1);
    expect(profileBackoff.canRun(Date.now() + 10 * 60 * 1000 + 5000)).toBe(true);
  });
});

describe("a catch-up run (default: keep learning)", () => {
  it.each(hosts)("%s: a pass runs while a catch-up run is active in this process", async (host) => {
    expect(profileCatchUpLock.begin()).toBe(true);
    const result = await run(host);
    expect(result.outcome).toBe("saved");
    expect(world.modelCalls).toBe(1);
  });

  it.each(hosts)("%s: a pass runs while another process holds the run record", async (host) => {
    world.leaseActive = true;
    const result = await run(host);
    expect(result.outcome).toBe("saved");
    expect(world.modelCalls).toBe(1);
  });

  it.each(hosts)("%s: pause makes no model call during a run in this process", async (host) => {
    profileCatchUpLock.begin();
    const result = await run(host, { config: { userProfileDuringCatchUp: "pause" } });
    expect(result.outcome).toBe("skipped");
    expect(world.modelCalls).toBe(0);
    expect(world.learned.size).toBe(0);
  });

  it.each(hosts)("%s: pause makes no model call while another process runs", async (host) => {
    world.leaseActive = true;
    const result = await run(host, { config: { userProfileDuringCatchUp: "pause" } });
    expect(result.outcome).toBe("skipped");
    expect(world.modelCalls).toBe(0);
  });
});

// Added with the pass (slice C): the batch claim of design D5, seen from the pass.
describe("the batch claim", () => {
  it.each(hosts)("%s: claims the newest batch and releases nothing on success", async (host) => {
    const result = await run(host);
    expect(result.outcome).toBe("saved");
    expect(world.claimOptions).toEqual([{ recentFirst: true, claim: true }]);
    expect(world.released).toEqual([]);
  });

  it.each(hosts)("%s: a failed pass releases exactly its claimed prompts", async (host) => {
    world.reply = () => ({ preferences: "nope" });
    const result = await run(host);
    expect(result.outcome).toBe("failed");
    expect(world.released).toEqual([["p0", "p1", "p2", "p3", "p4"]]);
  });
});

// A storage error between the profile save and the mark must not make the next pass learn
// the same batch again (issue 294).
describe("the mark after a save", () => {
  it.each(hosts)("%s: a failed mark is retried and the pass stays saved", async (host) => {
    world.markFailures = 1;
    const result = await run(host);
    expect(result).toEqual({ outcome: "saved" });
    expect(world.released).toEqual([]);
    expect([...world.learned].sort()).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(world.saves).toHaveLength(1);
  });

  it.each(hosts)("%s: a mark that keeps failing never releases a saved batch", async (host) => {
    world.markFailures = 99;
    const result = await run(host);
    expect(result).toEqual({ outcome: "saved" });
    expect(world.released).toEqual([]);
    expect(world.saves).toHaveLength(1);
    expect(profileBackoff.canRun()).toBe(true);
  });

  it.each(hosts)(
    "%s: after the claim runs out, the next pass retries the mark and saves nothing again",
    async (host) => {
      world.markFailures = 3;
      expect(await run(host)).toEqual({ outcome: "saved" });
      expect(world.learned.size).toBe(0);
      // The fake store ignores claims, as a store does once the 10-minute claim runs out.
      const second = await run(host);
      expect(second.outcome).toBe("skipped");
      expect(world.saves).toHaveLength(1);
      expect([...world.learned].sort()).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    }
  );

  it.each(hosts)(
    "%s: after a restart, a saved batch is marked without a model call or a second save",
    async (host) => {
      world.markFailures = 99;
      expect(await run(host)).toEqual({ outcome: "saved" });
      // The pass keeps nothing in memory, so this is what a restart sees. The fake store
      // ignores claims, as a store does once the 10-minute claim runs out.
      world.markFailures = 0;
      expect((await run(host)).outcome).toBe("skipped");
      expect(world.modelCalls).toBe(1);
      expect(world.saves).toHaveLength(1);
      expect([...world.learned].sort()).toEqual(["p0", "p1", "p2", "p3", "p4"]);
      expect(world.ledger.size).toBe(0);
    }
  );

  it.each(hosts)("%s: a pass waits while the earlier mark still fails", async (host) => {
    // Three tries fail in the first pass and three more in the second.
    world.markFailures = 6;
    await run(host);
    const second = await run(host);
    expect(second.outcome).toBe("skipped");
    expect(world.saves).toHaveLength(1);
    expect(world.learned.size).toBe(0);
    // The store works again: the mark is retried, nothing is saved twice.
    await run(host);
    expect(world.saves).toHaveLength(1);
    expect(world.learned.size).toBe(5);
  });
});

// Each model attempt has its own time limit (scenario "OpenCode model fails"): a host model
// timeout reaches the external API, and the external call gets a fresh limit. The limit is
// passed in scaled down, so no test waits 120 seconds.
describe("each model attempt has its own time limit", () => {
  const LIMIT = 50;
  type Options = { attemptTimeoutMs?: number };
  async function loadFallback() {
    return (await import("../src/core/profile-learning/fallback.js")) as {
      withExternalFallback: (
        host: HostName,
        primary: unknown,
        external: unknown,
        notify: (notice: Notice) => void,
        options?: Options
      ) => unknown;
    };
  }
  const never = <T>() => new Promise<T>(() => {});
  const hanging = {
    provider: "host",
    modelId: "host-model",
    complete: () => never<string>(),
    completeStructured: () => never<unknown>(),
  };
  const warnings = () => world.notices.filter((notice) => notice.variant === "warning");

  it.each(["opencode", "pi"] as const)(
    "%s: a host model that never answers falls back and the pass saves",
    async (host) => {
      const { withExternalFallback } = await loadFallback();
      const model = withExternalFallback(
        host,
        hanging,
        makePort(),
        (notice) => {
          world.notices.push(notice);
        },
        { attemptTimeoutMs: LIMIT }
      );
      const result = await run(host, { model });
      expect(result.outcome).toBe("saved");
      expect(world.modelCalls).toBe(1);
      expect(warnings()).toHaveLength(1);
      expect(world.saves).toHaveLength(1);
    },
    3000
  );

  it("the overall limit does not cut the external call short", async () => {
    // OpenCode's port has its own limit of the same length as the overall one. Today both
    // start together, so the overall one fails the pass while the external call runs.
    const { withExternalFallback } = await loadFallback();
    const { analyzeProfile } = await import("../src/core/profile-analysis.js");
    const selfLimited = {
      provider: "host",
      modelId: "host-model",
      complete: () => never<string>(),
      completeStructured: () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("user-profile-learning: timeout")), LIMIT)
        ),
    };
    const external = {
      provider: "external",
      modelId: "",
      async complete() {
        world.modelCalls++;
        await new Promise((resolve) => setTimeout(resolve, LIMIT / 2));
        return JSON.stringify(empty);
      },
    };
    const model = withExternalFallback(
      "opencode",
      selfLimited,
      external,
      (notice) => {
        world.notices.push(notice);
      },
      { attemptTimeoutMs: LIMIT }
    );
    const result = await analyzeProfile(model as never, "prompts", null, LIMIT);
    expect(result.raw).toEqual(empty);
    expect(world.modelCalls).toBe(1);
    expect(warnings()).toHaveLength(1);
  });

  it("an external model that also hangs fails the pass with timeout after two limits", async () => {
    const { withExternalFallback } = await loadFallback();
    const model = withExternalFallback(
      "opencode",
      hanging,
      { ...hanging, provider: "external", completeStructured: undefined },
      (notice) => {
        world.notices.push(notice);
      },
      { attemptTimeoutMs: LIMIT }
    );
    const started = Date.now();
    const result = await run("opencode", { model });
    const elapsed = Date.now() - started;
    expect(result).toEqual({ outcome: "failed", reason: "timeout" });
    expect(elapsed).toBeGreaterThanOrEqual(2 * LIMIT - 5);
    expect(elapsed).toBeLessThan(3 * LIMIT + 100);
    expect(warnings()).toHaveLength(1);
    expect(world.saves).toEqual([]);
  }, 3000);
});

// The log gets counts and indexes only: a model's reason and a profile item's description
// may quote the user's prompts (CLAUDE.md, Security).
describe("the check of older items logs no model or profile text", () => {
  const REASON = "Reason-text-zq81 quoting the user's prompts";
  const DESCRIPTION = "Description-text-zq82 about tabs";
  const logText = () => JSON.stringify(world.logs);

  it.each(hosts)("%s: the verdict reasons stay out of the log", async (host) => {
    const data = profileData(8);
    data.preferences[0]!.description = DESCRIPTION;
    data.preferences[0]!.confidence = 0.99;
    world.profile = { id: "p1", data, total: 5 };
    world.reply = () => ({
      ...empty,
      validations: [
        { index: 0, verdict: "confirmed", reason: REASON },
        { index: 1, verdict: "no_evidence", reason: REASON },
      ],
    });
    const result = await run(host, { config: { userProfileValidationEnabled: true } });
    expect(result.outcome).toBe("saved");
    expect(world.logs.some((record) => record.message.includes("validation results"))).toBe(true);
    expect(logText()).not.toContain("zq81");
    expect(logText()).not.toContain("zq82");
  });

  it("a verdict with no matching item logs its index, not the item text", async () => {
    const { applyValidations } = await import("../src/core/profile-learning/validation.js");
    const store = { syncConfidence: () => {}, evolveAndUpdate: async () => {} };
    const reply = {
      ...empty,
      validations: [{ index: 0, verdict: "confirmed", reason: REASON }],
    };
    await applyValidations(store, { ...empty } as never, reply as never, "p1", [
      `Code style||${DESCRIPTION.slice(0, 30)}`,
    ]);
    const record = world.logs.find((entry) => entry.message.includes("match failed"));
    expect(record?.data).toEqual({ index: 0 });
    expect(logText()).not.toContain("zq8");
  });
});

// Two items can share a category and the first 30 characters of a description. The verdict
// for one must not land on the other (issue 294).
describe("the validation key names one item", () => {
  const item = (description: string) => ({
    category: "Code style",
    description,
    confidence: 0.9,
    frequency: 2,
    evidence: [],
    lastSeen: 1,
    alpha: 4,
    beta: 1,
  });
  const SHARED = "Prefers small focused functions";
  const first = item(`${SHARED} in the handlers.`);
  const second = item(`${SHARED} in the tests.`);

  it("the two keys differ although the first 30 characters match", async () => {
    const { buildValidationTask } = await import("../src/core/profile-learning/validation.js");
    const others = Array.from({ length: 3 }, (_, i) => item(`Another preference number ${i}`));
    const task = buildValidationTask({
      ...empty,
      preferences: [first, second, ...others],
    } as never);
    expect(task).not.toBeNull();
    expect(new Set(task!.keys).size).toBe(task!.keys.length);
  });

  it("a verdict changes the item it names and leaves the look-alike alone", async () => {
    const { buildValidationTask, applyValidations } =
      await import("../src/core/profile-learning/validation.js");
    const others = Array.from({ length: 3 }, (_, i) => item(`Another preference number ${i}`));
    const data = { ...empty, preferences: [first, second, ...others] };
    const task = buildValidationTask(data as never)!;
    const target = data.preferences.find((p) => p.description === second.description)!;
    const index = task.keys.findIndex((key) => key.includes("in the tests"));
    const live = JSON.parse(JSON.stringify(data));
    const store = { syncConfidence: () => {}, evolveAndUpdate: async () => {} };
    const reply = { ...empty, validations: [{ index, verdict: "confirmed", reason: "seen" }] };
    await applyValidations(store, live, reply as never, "p1", task.keys);
    const byText = (text: string) =>
      live.preferences.find((p: { description: string }) => p.description.includes(text));
    expect(byText("in the tests").alpha).toBe((target.alpha ?? 1) + 0.5);
    expect(byText("in the handlers").alpha).toBe(4);
  });
});
