import { describe, expect, it } from "bun:test";
import { MAX_TRACKED_SESSIONS, registerV2Adapter } from "../src/v2/adapter.js";
import type { V2MemoryBridge } from "../src/v2/memory-bridge.js";

type SystemPart = { type: string; text: string };

function createHarness(
  options: {
    events?: any[];
    memory?: Partial<V2MemoryBridge>;
    legacy?: Record<string, any>;
  } = {}
) {
  const hooks = new Map<string, (event: any) => Promise<void>>();
  const calls = {
    retrieve: [] as Array<[string, string]>,
    record: [] as Array<[string, string, string]>,
    restore: [] as string[],
    legacyEvents: [] as any[],
    chatParams: [] as any[],
    synthetic: 0,
    prompt: 0,
  };
  let tool: any;
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
        callback({ add: (definition: any) => (tool = definition) });
      },
    },
    session: {
      hook: async (name: string, callback: (event: any) => Promise<void>) => {
        hooks.set(name, callback);
      },
      get: async () => ({ location: { directory: "/workspace/project" } }),
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
    isInternalPrompt: () => false,
    recordPrompt: async (sessionID, messageID, text) => {
      calls.record.push([sessionID, messageID, text]);
    },
    retrieve: async (prompt, sessionID) => {
      calls.retrieve.push([prompt, sessionID]);
      return `<omms-retrieval>\nfor: ${prompt}\n</omms-retrieval>`;
    },
    restoreSession: async (sessionID) => {
      calls.restore.push(sessionID);
      return "## Restored Session Memory\n\n### Memory 1\nUse WAL mode\n\n";
    },
    ...options.memory,
  };

  const legacy = {
    tool: {
      memory: {
        description: "Memory tool",
        execute: async (args: any) => JSON.stringify({ success: true, args }),
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
  const context = async (sessionID: string, admitted = sentMessageIDs.get(sessionID) ?? []) => {
    const event = {
      sessionID,
      model: { providerID: "anthropic", id: "claude" },
      system: [] as SystemPart[],
      messages: admitted.map((id) => ({ id, role: "user" })),
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
    getTool: () => tool,
    isAborted: () => aborted,
    isDisposed: () => disposed,
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
