import { describe, expect, it } from "bun:test";
import { MAX_SEEN_SESSIONS, MAX_TRACKED_SESSIONS, registerV2Adapter } from "../src/v2/adapter.js";
import type { V2MemoryBridge } from "../src/v2/memory-bridge.js";

type SystemPart = { type: string; text: string };

const RESTORED_MEMORIES = [{ memory: "Use WAL mode", tags: [] }];
const RESTORED_SECTION = "## Restored Session Memory\n\n### Memory 1\nUse WAL mode\n\n";

function createHarness(
  options: {
    events?: any[];
    memory?: Partial<V2MemoryBridge>;
    legacy?: Record<string, any>;
    /** Stub for `ctx.session.get`; the default returns a root session. */
    getSession?: (input: { sessionID: string }) => Promise<unknown>;
  } = {}
) {
  const hooks = new Map<string, (event: any) => Promise<void>>();
  const calls = {
    retrieve: [] as Array<[string, string]>,
    retrieveFirst: [] as Array<[string, string]>,
    record: [] as Array<[string, string, string]>,
    restore: [] as string[],
    legacyEvents: [] as any[],
    chatParams: [] as any[],
    synthetic: 0,
    prompt: 0,
  };
  let requestBudget = 8_000;
  const tools = new Map<string, any>();
  let aborted = false;
  let disposed = false;
  let eventsDrained!: () => void;
  const drained = new Promise<void>((resolve) => {
    eventsDrained = resolve;
  });

  const ctx = {
    location: {
      directory: "/workspace/project",
      project: { id: "project", directory: "/workspace/project", canonical: "project" },
    },
    tool: {
      transform: async (callback: (editor: any) => void) => {
        callback({ add: (definition: any) => tools.set(definition.name, definition) });
      },
    },
    session: {
      hook: async (name: string, callback: (event: any) => Promise<void>) => {
        hooks.set(name, callback);
      },
      get: options.getSession ?? (async () => ({ location: { directory: "/workspace/project" } })),
      synthetic: async () => {
        calls.synthetic++;
      },
      prompt: async () => {
        calls.prompt++;
      },
    },
    event: {
      async *subscribe({ signal }: { signal: AbortSignal }) {
        for (const event of options.events ?? []) yield event;
        eventsDrained();
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true }
          )
        );
      },
    },
  } as any;

  const memory: V2MemoryBridge = {
    retrievalTimeoutMs: 50,
    isConfigured: () => true,
    isInjectionEnabled: () => true,
    isCompactionEnabled: () => true,
    isVisibleRecallEnabled: () => true,
    isSubagentMemoryEnabled: () => true,
    isInternalPrompt: () => false,
    recordPrompt: async (sessionID, messageID, text) => {
      calls.record.push([sessionID, messageID, text]);
    },
    snapshotRequestBudget: () => requestBudget,
    retrieve: async (prompt, sessionID) => {
      calls.retrieve.push([prompt, sessionID]);
      return `<omms-retrieval>\nfor: ${prompt}\n</omms-retrieval>`;
    },
    // By default the first prompt of a session has no opening section, so a test that does not
    // care about the opening context sees the same sections as before.
    retrieveFirstPrompt: async (prompt, sessionID, budgetBytes) => {
      return {
        promptSection: await memory.retrieve(prompt, sessionID, budgetBytes),
        openingSection: null,
        openingQuery: null,
      };
    },
    restoreSession: async (sessionID) => {
      calls.restore.push(sessionID);
      return RESTORED_MEMORIES;
    },
    formatRestoredSession: (memories, budgetBytes) =>
      RESTORED_SECTION.length <= budgetBytes ? RESTORED_SECTION : null,
    ...options.memory,
  };

  // Count first-prompt searches whichever implementation the test installs.
  const firstPromptSearch = memory.retrieveFirstPrompt.bind(memory);
  memory.retrieveFirstPrompt = async (prompt, sessionID, budgetBytes) => {
    calls.retrieveFirst.push([prompt, sessionID]);
    return firstPromptSearch(prompt, sessionID, budgetBytes);
  };

  const legacy = {
    tool: {
      memory: {
        description: "Memory tool",
        execute: async (args: any) => JSON.stringify({ success: true, args }),
      },
      skills: {
        description: "Skills tool",
        execute: async (args: any) => JSON.stringify({ success: true, mode: args.mode }),
      },
    },
    "chat.message": async () => {
      throw new Error("v2 must not call the V1 chat.message hook");
    },
    config: async () => {
      throw new Error("v2 must not call the V1 config hook");
    },
    "chat.params": async (input: any) => {
      calls.chatParams.push(input);
    },
    event: async (input: any) => {
      calls.legacyEvents.push(input.event);
    },
    dispose: async () => {
      disposed = true;
    },
    ...options.legacy,
  };

  const sentMessageIDs = new Map<string, string[]>();

  const prompt = (sessionID: string, text: string, messageID = `msg-${text}`) => {
    sentMessageIDs.set(sessionID, [...(sentMessageIDs.get(sessionID) ?? []), messageID]);
    return hooks.get("prompt")!({ sessionID, messageID, prompt: { text } });
  };

  // By default every prompt sent so far is admitted, i.e. present in the
  // model request's history; pass `admitted` to simulate unadmitted prompts.
  // `history` lists user messages from before this process saw the session (a resumed session).
  const context = async (
    sessionID: string,
    admitted = sentMessageIDs.get(sessionID) ?? [],
    history: string[] = []
  ) => {
    const event = {
      sessionID,
      model: { providerID: "anthropic", id: "claude" },
      system: [] as SystemPart[],
      messages: [...history, ...admitted].map((id) => ({ id, role: "user" })),
    };
    await hooks.get("context")!(event);
    return event.system.map((part) => part.text);
  };

  const compaction = (sessionID: string) =>
    hooks.get("compaction")!({
      sessionID,
      model: { providerID: "anthropic", id: "claude" },
      system: [] as SystemPart[],
    });

  return {
    ctx,
    memory,
    legacy,
    calls,
    hooks,
    prompt,
    context,
    compaction,
    drained,
    getTool: (name = "memory") => tools.get(name),
    toolNames: () => [...tools.keys()],
    isAborted: () => aborted,
    isDisposed: () => disposed,
    setRequestBudget: (bytes: number) => {
      requestBudget = bytes;
    },
    register: () => registerV2Adapter(ctx, legacy, memory),
  };
}

describe("OpenCode v2 plugin adapter", () => {
  it("registers the memory tool and bridges it to the shared tool", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    expect(h.getTool().name).toBe("memory");
    expect(h.getTool().options).toEqual({ codemode: false });
    const result = await h
      .getTool()
      .execute({ mode: "help" }, { sessionID: "ses-1", messageID: "msg-1", agent: "build" });
    expect(JSON.parse(result.content)).toEqual({ success: true, args: { mode: "help" } });
    expect([...h.hooks.keys()].sort()).toEqual(["compaction", "context", "prompt"]);

    await cleanup();
  });

  it("registers the V1 skills tool as a direct V2 tool with the shared modes", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    expect(h.toolNames()).toEqual(["memory", "skills"]);
    const skills = h.getTool("skills");
    expect(skills.description).toBe("Skills tool");
    expect(skills.options).toEqual({ codemode: false });
    // The V2 tool must carry the shared mode list and arguments unchanged.
    const { SKILLS_TOOL_MODES, SKILLS_TOOL_INPUT_SCHEMA } =
      await import("../src/core/skills-tool.js");
    expect(skills.input.properties.mode.enum).toEqual([...SKILLS_TOOL_MODES]);
    expect(skills.input.properties.mode.enum).toContain("propose");
    expect(Object.keys(skills.input.properties).sort()).toEqual(
      Object.keys(SKILLS_TOOL_INPUT_SCHEMA.properties).sort()
    );
    const result = await skills.execute(
      { mode: "list" },
      { sessionID: "ses-1", messageID: "msg-1", agent: "build" }
    );
    expect(JSON.parse(result.content)).toEqual({ success: true, mode: "list" });

    await cleanup();
  });

  it("starts one search per prompt and records the prompt once it is admitted", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    await h.prompt("ses-1", "how is the queue locked?", "msg-1");

    expect(h.calls.retrieve).toEqual([["how is the queue locked?", "ses-1"]]);
    expect(h.calls.record).toEqual([]);

    await h.context("ses-1");
    await h.context("ses-1");
    expect(h.calls.record).toEqual([["ses-1", "msg-1", "how is the queue locked?"]]);

    await cleanup();
  });

  it("never records a prompt that is not admitted", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    await h.prompt("ses-1", "rejected by a later hook", "msg-rejected");
    await h.prompt("ses-1", "accepted", "msg-accepted");
    await h.context("ses-1", ["msg-accepted"]);

    expect(h.calls.record).toEqual([["ses-1", "msg-accepted", "accepted"]]);

    await cleanup();
  });

  it("applies the same section to every model step of a prompt and searches once", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    await h.prompt("ses-1", "queue locking");
    const first = await h.context("ses-1");
    const second = await h.context("ses-1");

    expect(first).toEqual(["<omms-retrieval>\nfor: queue locking\n</omms-retrieval>"]);
    expect(second).toEqual(first);
    expect(h.calls.retrieve).toHaveLength(1);

    await cleanup();
  });

  it("replaces the section when a later prompt arrives", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    await h.prompt("ses-1", "first question");
    await h.context("ses-1");
    await h.prompt("ses-1", "second question");

    expect(await h.context("ses-1")).toEqual([
      "<omms-retrieval>\nfor: second question\n</omms-retrieval>",
    ]);

    await cleanup();
  });

  it("adds nothing when retrieval finds nothing", async () => {
    const h = createHarness({ memory: { retrieve: async () => null } });
    const cleanup = await h.register();

    await h.prompt("ses-1", "unrelated");
    expect(await h.context("ses-1")).toEqual([]);

    await cleanup();
  });

  it("proceeds without memory when retrieval throws", async () => {
    const h = createHarness({
      memory: {
        retrieve: async () => {
          throw new Error("search failed");
        },
      },
    });
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    expect(await h.context("ses-1")).toEqual([]);

    await cleanup();
  });

  it("proceeds without memory when retrieval times out, and stays consistent", async () => {
    let finish!: (value: string) => void;
    const h = createHarness({
      memory: {
        retrievalTimeoutMs: 10,
        retrieve: () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      },
    });
    const cleanup = await h.register();

    await h.prompt("ses-1", "slow question");
    expect(await h.context("ses-1")).toEqual([]);
    finish("<omms-retrieval>\nlate\n</omms-retrieval>");
    await Bun.sleep(0);
    expect(await h.context("ses-1")).toEqual([]);

    await cleanup();
  });

  it("does not search when injection is disabled but still records the prompt", async () => {
    const h = createHarness({ memory: { isInjectionEnabled: () => false } });
    const cleanup = await h.register();

    await h.prompt("ses-1", "question", "msg-1");

    expect(h.calls.retrieve).toEqual([]);
    expect(await h.context("ses-1")).toEqual([]);
    expect(h.calls.record).toEqual([["ses-1", "msg-1", "question"]]);

    await cleanup();
  });

  it("does nothing for unconfigured memory or internal prompts", async () => {
    const unconfigured = createHarness({ memory: { isConfigured: () => false } });
    let cleanup = await unconfigured.register();
    await unconfigured.prompt("ses-1", "question");
    expect(unconfigured.calls.record).toEqual([]);
    expect(unconfigured.calls.retrieve).toEqual([]);
    await cleanup();

    const internal = createHarness({ memory: { isInternalPrompt: () => true } });
    cleanup = await internal.register();
    await internal.prompt("ses-1", "# User Profile Analysis");
    expect(internal.calls.record).toEqual([]);
    expect(internal.calls.retrieve).toEqual([]);
    await cleanup();
  });

  it("keeps bridging the prompt model to V1 chat.params", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    await h.prompt("ses-1", "Implement V2", "msg-1");
    await h.context("ses-1");

    expect(h.calls.chatParams).toEqual([
      { message: { id: "msg-1" }, model: { providerID: "anthropic", id: "claude" } },
    ]);

    await cleanup();
  });

  it("restores the session's memories after compaction without writing to the session", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    await h.compaction("ses-1");
    const system = await h.context("ses-1");

    expect(h.calls.restore).toEqual(["ses-1"]);
    expect(system).toEqual([
      "<omms-retrieval>\nfor: question\n</omms-retrieval>",
      "## Restored Session Memory\n\n### Memory 1\nUse WAL mode\n\n",
    ]);
    expect(h.calls.synthetic).toBe(0);
    expect(h.calls.prompt).toBe(0);
    expect(await h.context("ses-2")).toEqual([]);

    await cleanup();
  });

  it("skips compaction restore when it is disabled", async () => {
    const h = createHarness({ memory: { isCompactionEnabled: () => false } });
    const cleanup = await h.register();

    await h.compaction("ses-1");

    expect(h.calls.restore).toEqual([]);
    expect(await h.context("ses-1")).toEqual([]);

    await cleanup();
  });

  it("does not forward compaction events to the V1 handler", async () => {
    const h = createHarness({
      events: [
        {
          type: "session.compaction.ended",
          location: { directory: "/workspace/project" },
          data: { sessionID: "ses-1" },
        },
        {
          type: "session.compacted",
          location: { directory: "/workspace/project" },
          data: { sessionID: "ses-1" },
        },
        {
          type: "session.idle",
          location: { directory: "/workspace/project" },
          data: { sessionID: "ses-1" },
        },
      ],
    });
    const cleanup = await h.register();
    await h.drained;
    await Bun.sleep(0);

    expect(h.calls.legacyEvents).toEqual([
      { type: "session.idle", properties: { sessionID: "ses-1" } },
    ]);

    await cleanup();
  });

  it("starts capture when OpenCode 2.0.14 reports a finished turn instead of session.idle", async () => {
    const h = createHarness({
      events: [
        {
          type: "session.execution.started",
          location: { directory: "/workspace/project" },
          data: { sessionID: "ses-1" },
        },
        {
          type: "session.execution.succeeded",
          location: { directory: "/workspace/project" },
          data: { sessionID: "ses-1" },
        },
        {
          type: "session.status",
          location: { directory: "/workspace/project" },
          data: { sessionID: "ses-2", status: { type: "idle" } },
        },
        {
          type: "session.status",
          location: { directory: "/workspace/project" },
          data: { sessionID: "ses-3", status: { type: "busy" } },
        },
        {
          type: "session.status",
          location: { directory: "/workspace/project" },
          properties: { sessionID: "ses-4", status: { type: "idle" } },
        },
      ],
    });
    const cleanup = await h.register();
    await h.drained;
    await Bun.sleep(0);

    const idle = h.calls.legacyEvents.filter((event: any) => event.type === "session.idle");
    expect(idle).toEqual([
      { type: "session.idle", properties: { sessionID: "ses-1" } },
      { type: "session.idle", properties: { sessionID: "ses-2" } },
      { type: "session.idle", properties: { sessionID: "ses-4" } },
    ]);

    await cleanup();
  });

  it("forgets a deleted session", async () => {
    let releaseEvents!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseEvents = resolve;
    });
    const h = createHarness();
    h.ctx.event.subscribe = async function* ({ signal }: { signal: AbortSignal }) {
      await gate;
      yield { type: "session.deleted", data: { sessionID: "ses-1" } };
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true })
      );
    };
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    await h.compaction("ses-1");
    releaseEvents();
    await Bun.sleep(0);

    expect(await h.context("ses-1")).toEqual([]);

    await cleanup();
  });

  it("bounds per-session state", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    for (let i = 0; i <= MAX_TRACKED_SESSIONS; i++) {
      await h.prompt(`ses-${i}`, `question ${i}`);
    }

    expect(await h.context("ses-0")).toEqual([]);
    expect(await h.context(`ses-${MAX_TRACKED_SESSIONS}`)).toHaveLength(1);

    await cleanup();
  });

  it("aborts the subscription, releases state, and disposes on cleanup", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    await h.compaction("ses-1");
    await cleanup();

    expect(h.isAborted()).toBe(true);
    expect(h.isDisposed()).toBe(true);
    expect(await h.context("ses-1")).toEqual([]);
  });
});

const PROMPT_SECTION = (text: string) => `<omms-retrieval>\nfor: ${text}\n</omms-retrieval>`;
const OPENING_SECTION = "<omms-retrieval>\nopening memories\n</omms-retrieval>";
const OPENING_QUERY = "project architecture, setup, conventions and key decisions";

/** A bridge whose first-prompt method returns a prompt section and an opening section. */
function withOpening(): Partial<V2MemoryBridge> {
  return {
    retrieveFirstPrompt: async (prompt) => ({
      promptSection: PROMPT_SECTION(prompt),
      openingSection: OPENING_SECTION,
      openingQuery: OPENING_QUERY,
    }),
  };
}

describe("OpenCode v2 first prompt, resume and subagent sessions", () => {
  it("adds the prompt section and then the opening section on every request of the first prompt", async () => {
    const h = createHarness({ memory: withOpening() });
    const cleanup = await h.register();

    await h.prompt("ses-1", "first question");
    const first = await h.context("ses-1");
    const second = await h.context("ses-1");

    expect(first).toEqual([PROMPT_SECTION("first question"), OPENING_SECTION]);
    expect(second).toEqual(first);
    expect(h.calls.retrieveFirst).toEqual([["first question", "ses-1"]]);
    expect(h.calls.retrieve).toHaveLength(0);
    expect(h.calls.restore).toEqual([]);

    await cleanup();
  });

  it("adds no opening section on the second prompt of a session", async () => {
    const h = createHarness({ memory: withOpening() });
    const cleanup = await h.register();

    await h.prompt("ses-1", "first question");
    await h.context("ses-1");
    await h.prompt("ses-1", "second question");

    expect(await h.context("ses-1")).toEqual([PROMPT_SECTION("second question")]);
    expect(h.calls.retrieveFirst).toHaveLength(1);
    expect(h.calls.retrieve).toEqual([["second question", "ses-1"]]);

    await cleanup();
  });

  it("gives a session with an earlier user message the restored section once, and no opening section", async () => {
    const h = createHarness({ memory: withOpening() });
    const cleanup = await h.register();

    await h.prompt("ses-1", "back again");
    const first = await h.context("ses-1", undefined, ["msg-old"]);
    const second = await h.context("ses-1", undefined, ["msg-old"]);

    expect(first).toEqual([PROMPT_SECTION("back again"), RESTORED_SECTION]);
    expect(second).toEqual(first);
    expect(h.calls.restore).toEqual(["ses-1"]);
    expect(h.calls.synthetic).toBe(0);
    expect(h.calls.prompt).toBe(0);

    await cleanup();
  });

  it("does not read two quick prompts of a new session as a resumed session", async () => {
    const h = createHarness({ memory: withOpening() });
    const cleanup = await h.register();

    // The second prompt arrives before the first request: both are in the history, both are ours.
    await h.prompt("ses-1", "first question");
    await h.prompt("ses-1", "second question");
    await h.context("ses-1");

    expect(h.calls.restore).toEqual([]);

    await cleanup();
  });

  it("does not read a user message without an id as an earlier prompt", async () => {
    const h = createHarness({ memory: withOpening() });
    const cleanup = await h.register();

    await h.prompt("ses-1", "first question");
    const event = {
      sessionID: "ses-1",
      model: { providerID: "anthropic", id: "claude" },
      system: [] as SystemPart[],
      messages: [{ role: "user" }],
    };
    await h.hooks.get("context")!(event);

    expect(h.calls.restore).toEqual([]);
    expect(event.system.map((part) => part.text)).toEqual([
      PROMPT_SECTION("first question"),
      OPENING_SECTION,
    ]);

    await cleanup();
  });

  it("restores nothing on resume when compaction restore is disabled, and still drops the opening section", async () => {
    const h = createHarness({
      memory: { ...withOpening(), isCompactionEnabled: () => false },
    });
    const cleanup = await h.register();

    await h.prompt("ses-1", "back again");

    expect(await h.context("ses-1", undefined, ["msg-old"])).toEqual([
      PROMPT_SECTION("back again"),
    ]);
    expect(h.calls.restore).toEqual([]);

    await cleanup();
  });

  it("gives a session that already has restored memories no second resume load on later prompts", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    await h.prompt("ses-1", "one");
    await h.context("ses-1", undefined, ["msg-old"]);
    await h.prompt("ses-1", "two");
    await h.context("ses-1", undefined, ["msg-old"]);

    expect(h.calls.restore).toEqual(["ses-1"]);

    await cleanup();
  });

  it("starts no retrieval for a session with a parent when subagent memory is off", async () => {
    const h = createHarness({
      memory: { ...withOpening(), isSubagentMemoryEnabled: () => false },
      getSession: async ({ sessionID }) => ({ id: sessionID, parentID: "ses-root" }),
    });
    const cleanup = await h.register();

    await h.prompt("ses-child", "do the task", "msg-child");

    expect(h.calls.retrieve).toEqual([]);
    expect(h.calls.retrieveFirst).toEqual([]);
    expect(await h.context("ses-child")).toEqual([]);
    // The prompt is still recorded for capture.
    expect(h.calls.record).toEqual([["ses-child", "msg-child", "do the task"]]);

    await cleanup();
  });

  it("keeps the prompt recall for a session with a parent when subagent memory is on, without opening or resume sections", async () => {
    const h = createHarness({
      memory: withOpening(),
      getSession: async ({ sessionID }) => ({ id: sessionID, parentID: "ses-root" }),
    });
    const cleanup = await h.register();

    await h.prompt("ses-child", "do the task");
    const system = await h.context("ses-child", undefined, ["msg-old"]);

    expect(system).toEqual([PROMPT_SECTION("do the task")]);
    expect(h.calls.retrieve).toEqual([["do the task", "ses-child"]]);
    expect(h.calls.retrieveFirst).toEqual([]);
    expect(h.calls.restore).toEqual([]);

    await cleanup();
  });

  it("counts a session as a root session when the parent lookup fails", async () => {
    for (const getSession of [
      async () => {
        throw new Error("lookup failed");
      },
      async () => undefined,
    ]) {
      const h = createHarness({
        memory: { ...withOpening(), isSubagentMemoryEnabled: () => false },
        getSession,
      });
      const cleanup = await h.register();

      await h.prompt("ses-1", "question");

      expect(await h.context("ses-1")).toEqual([PROMPT_SECTION("question"), OPENING_SECTION]);

      await cleanup();
    }
  });

  it("treats a compacted session as seen, so its next prompt is not a first prompt", async () => {
    const h = createHarness({ memory: withOpening() });
    const cleanup = await h.register();

    await h.compaction("ses-1");
    await h.prompt("ses-1", "after compaction");

    expect(h.calls.retrieveFirst).toEqual([]);
    expect(h.calls.retrieve).toEqual([["after compaction", "ses-1"]]);

    await cleanup();
  });

  it("treats a session as new again after it is deleted", async () => {
    let releaseEvents!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseEvents = resolve;
    });
    const h = createHarness({ memory: withOpening() });
    h.ctx.event.subscribe = async function* ({ signal }: { signal: AbortSignal }) {
      await gate;
      yield { type: "session.deleted", data: { sessionID: "ses-1" } };
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true })
      );
    };
    const cleanup = await h.register();

    await h.prompt("ses-1", "one");
    releaseEvents();
    await Bun.sleep(0);
    await h.prompt("ses-1", "two");

    expect(h.calls.retrieveFirst).toEqual([
      ["one", "ses-1"],
      ["two", "ses-1"],
    ]);

    await cleanup();
  });

  it("bounds the set of seen sessions", async () => {
    const h = createHarness({ memory: withOpening() });
    const cleanup = await h.register();

    for (let i = 0; i <= MAX_SEEN_SESSIONS; i++) {
      await h.prompt(`ses-${i}`, `question ${i}`);
    }
    await h.prompt("ses-0", "again");

    expect(h.calls.retrieveFirst.filter(([, id]) => id === "ses-0")).toHaveLength(2);

    await cleanup();
  });
});
