import { describe, expect, it } from "bun:test";
import { MAX_TRACKED_SESSIONS, registerV2Adapter } from "../src/v2/adapter.js";
import type { V2MemoryBridge } from "../src/v2/memory-bridge.js";
import { MAX_RECALL_SUMMARIES } from "../src/v2/recall-reporter.js";
import { RECALL_RPC_ID } from "../src/v2/recall-rpc.js";
import { callTitle } from "../src/core/recall-summary.js";

const THREE_MEMORIES = [
  "<omms-retrieval>",
  '<memory id="m1" relevance="91%">',
  "## Request",
  "Use WAL mode",
  "</memory>",
  '<memory id="m2" relevance="80%">',
  "Prefer bun over npm",
  "</memory>",
  '<memory id="m3" relevance="55%">',
  "Keep files under 500 lines",
  "</memory>",
  "</omms-retrieval>",
].join("\n");

type RpcOptions = {
  registerFails?: boolean;
  emitFails?: "reject" | "throw";
  noRpc?: boolean;
};

function createHarness(
  options: {
    memory?: Partial<V2MemoryBridge>;
    events?: any[];
    /** The event stream yields its events only after this promise settles. */
    gate?: Promise<void>;
    rpc?: RpcOptions;
    /** Stub for `ctx.session.get`; the default returns a root session. */
    getSession?: (input: { sessionID: string }) => Promise<unknown>;
  } = {}
) {
  const hooks = new Map<string, (event: any) => Promise<void>>();
  const emitted: Array<[string, unknown]> = [];
  let handlers: any;
  let definitionID: string | undefined;

  const rpc = {
    register: async (definition: any, given: any) => {
      if (options.rpc?.registerFails) throw new Error("register failed");
      definitionID = definition.id;
      handlers = given;
      return {
        events: {
          emit: (name: string, data: unknown) => {
            if (options.rpc?.emitFails === "throw") throw new Error("emit threw");
            if (options.rpc?.emitFails === "reject")
              return Promise.reject(new Error("emit failed"));
            emitted.push([name, data]);
            return Promise.resolve();
          },
        },
      };
    },
  };

  const ctx = {
    location: {
      directory: "/workspace/project",
      project: { id: "project", directory: "/workspace/project", canonical: "project" },
    },
    ...(options.rpc?.noRpc ? {} : { rpc }),
    tool: { transform: async () => {} },
    session: {
      hook: async (name: string, callback: (event: any) => Promise<void>) => {
        hooks.set(name, callback);
      },
      get:
        options.getSession ?? (async ({ sessionID }: { sessionID: string }) => ({ id: sessionID })),
    },
    event: {
      async *subscribe({ signal }: { signal: AbortSignal }) {
        await options.gate;
        for (const event of options.events ?? []) yield event;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true })
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
    isInternalPrompt: () => false,
    recordPrompt: async () => {},
    snapshotRequestBudget: () => 8_000,
    retrieve: async () => THREE_MEMORIES,
    restoreSession: async () => null,
    formatRestoredSession: () => null,
    ...options.memory,
  };

  const legacy = { tool: { memory: { description: "m" }, skills: { description: "s" } } };
  const ids = new Map<string, string[]>();

  const prompt = (sessionID: string, text: string) => {
    const messageID = `msg-${sessionID}-${text}`;
    ids.set(sessionID, [...(ids.get(sessionID) ?? []), messageID]);
    return hooks.get("prompt")!({ sessionID, messageID, prompt: { text } });
  };

  const context = async (sessionID: string) => {
    const event = {
      sessionID,
      model: { providerID: "anthropic", id: "claude" },
      system: [] as Array<{ type: string; text: string }>,
      messages: (ids.get(sessionID) ?? []).map((id) => ({ id, role: "user" })),
    };
    await hooks.get("context")!(event);
    // The subagent lookup settles after the hook returns, so let it finish.
    await Bun.sleep(0);
    return event.system.map((part) => part.text);
  };

  const list = async (sessionID: string) => handlers.list({ sessionID }, {});

  return {
    emitted,
    prompt,
    context,
    list,
    definitionID: () => definitionID,
    register: () => registerV2Adapter(ctx, legacy, memory),
  };
}

describe("OpenCode v2 recall reporting", () => {
  it("records one search summary for a prompt retrieval, with the prompt as query", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    await h.prompt("ses-1", "how do we store things?");
    await h.context("ses-1");

    expect(h.definitionID()).toBe(RECALL_RPC_ID);
    const { items } = await h.list("ses-1");
    expect(items).toHaveLength(1);
    expect(items[0].mode).toBe("search");
    expect(items[0].query).toBe("how do we store things?");
    expect(items[0].items.map((item: any) => item.headline)).toEqual([
      "Use WAL mode",
      "Prefer bun over npm",
      "Keep files under 500 lines",
    ]);
    expect(h.emitted).toEqual([["recalled", { sessionID: "ses-1" }]]);

    await cleanup();
  });

  it("records once when the context hook runs for several model steps of one prompt", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    await h.context("ses-1");
    await h.context("ses-1");
    await h.context("ses-1");

    expect((await h.list("ses-1")).items).toHaveLength(1);
    expect(h.emitted).toHaveLength(1);

    await h.prompt("ses-1", "next question");
    await h.context("ses-1");
    expect((await h.list("ses-1")).items).toHaveLength(2);

    await cleanup();
  });

  it("records nothing for an empty, memory-less, failed, disabled or internal retrieval", async () => {
    const cases: Array<[string, Partial<V2MemoryBridge>]> = [
      ["null section", { retrieve: async () => null }],
      [
        "section without memory entries",
        { retrieve: async () => "<omms-retrieval>\nprofile only\n</omms-retrieval>" },
      ],
      [
        "rejected retrieval",
        {
          retrieve: async () => {
            throw new Error("search failed");
          },
        },
      ],
      ["injection disabled", { isInjectionEnabled: () => false }],
      ["internal prompt", { isInternalPrompt: () => true }],
    ];
    for (const [label, memory] of cases) {
      const h = createHarness({ memory });
      const cleanup = await h.register();

      await h.prompt("ses-1", "question");
      await h.context("ses-1");

      expect((await h.list("ses-1")).items, label).toEqual([]);
      expect(h.emitted, label).toEqual([]);
      await cleanup();
    }
  });

  describe("subagent sessions", () => {
    it("records nothing for a session with a parent, and injects the same bytes", async () => {
      const h = createHarness({
        getSession: async ({ sessionID }) => ({ id: sessionID, parentID: "ses-root" }),
      });
      const cleanup = await h.register();

      await h.prompt("ses-child", "question");
      expect(await h.context("ses-child")).toEqual([THREE_MEMORIES]);

      expect((await h.list("ses-child")).items).toEqual([]);
      expect(h.emitted).toEqual([]);
      await cleanup();
    });

    it("records one summary for a root session", async () => {
      const h = createHarness({
        getSession: async ({ sessionID }) => ({ id: sessionID }),
      });
      const cleanup = await h.register();

      await h.prompt("ses-root", "question");
      await h.context("ses-root");

      expect((await h.list("ses-root")).items).toHaveLength(1);
      expect(h.emitted).toEqual([["recalled", { sessionID: "ses-root" }]]);
      await cleanup();
    });

    it("records anyway, without throwing, when the session lookup fails", async () => {
      for (const getSession of [
        async () => {
          throw new Error("lookup failed");
        },
        async () => undefined,
      ]) {
        const h = createHarness({ getSession });
        const cleanup = await h.register();

        await h.prompt("ses-1", "question");
        expect(await h.context("ses-1")).toEqual([THREE_MEMORIES]);

        expect((await h.list("ses-1")).items).toHaveLength(1);
        await cleanup();
      }
    });

    it("looks a session up once across several prompts and model steps", async () => {
      const lookups: string[] = [];
      const h = createHarness({
        getSession: async ({ sessionID }) => {
          lookups.push(sessionID);
          return { id: sessionID };
        },
      });
      const cleanup = await h.register();

      for (const text of ["one", "two"]) {
        await h.prompt("ses-1", text);
        await h.context("ses-1");
        await h.context("ses-1");
      }
      await h.prompt("ses-2", "three");
      await h.context("ses-2");

      expect(lookups).toEqual(["ses-1", "ses-2"]);
      expect((await h.list("ses-1")).items).toHaveLength(2);
      await cleanup();
    });

    it("looks a session up again after it is deleted", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let lookups = 0;
      const h = createHarness({
        gate,
        events: [{ type: "session.deleted", data: { sessionID: "ses-1" } }],
        getSession: async ({ sessionID }) => {
          lookups++;
          return { id: sessionID };
        },
      });
      const cleanup = await h.register();

      await h.prompt("ses-1", "question");
      await h.context("ses-1");
      release();
      await Bun.sleep(0);
      await Bun.sleep(0);
      await h.prompt("ses-1", "again");
      await h.context("ses-1");

      expect(lookups).toBe(2);
      await cleanup();
    });
  });

  describe("a lookup that is still pending", () => {
    /** A lookup that settles only when the test says so. */
    function pendingLookup() {
      let settle!: () => void;
      const gate = new Promise<void>((resolve) => {
        settle = resolve;
      });
      return {
        settle,
        getSession: async ({ sessionID }: { sessionID: string }) => {
          await gate;
          return { id: sessionID };
        },
      };
    }

    it("stores nothing for a session deleted while the lookup was pending", async () => {
      let release!: () => void;
      const events = new Promise<void>((resolve) => {
        release = resolve;
      });
      const lookup = pendingLookup();
      const h = createHarness({
        gate: events,
        events: [{ type: "session.deleted", data: { sessionID: "ses-1" } }],
        getSession: lookup.getSession,
      });
      const cleanup = await h.register();

      await h.prompt("ses-1", "question");
      await h.context("ses-1");
      release();
      await Bun.sleep(0);
      await Bun.sleep(0);
      lookup.settle();
      await Bun.sleep(0);
      await Bun.sleep(0);

      expect((await h.list("ses-1")).items).toEqual([]);
      expect(h.emitted).toEqual([]);
      await cleanup();
    });

    it("stores nothing when the reporter is cleared while the lookup was pending", async () => {
      const lookup = pendingLookup();
      const h = createHarness({ getSession: lookup.getSession });
      const cleanup = await h.register();

      await h.prompt("ses-1", "question");
      await h.context("ses-1");
      await cleanup();
      lookup.settle();
      await Bun.sleep(0);
      await Bun.sleep(0);

      expect((await h.list("ses-1")).items).toEqual([]);
      expect(h.emitted).toEqual([]);
    });

    it("still stores for a session that was not deleted", async () => {
      const lookup = pendingLookup();
      const h = createHarness({ getSession: lookup.getSession });
      const cleanup = await h.register();

      await h.prompt("ses-1", "question");
      await h.context("ses-1");
      lookup.settle();
      await Bun.sleep(0);
      await Bun.sleep(0);

      expect((await h.list("ses-1")).items).toHaveLength(1);
      await cleanup();
    });
  });

  it("caps the stored query at 300 characters and keeps the row title the same", async () => {
    const h = createHarness();
    const cleanup = await h.register();
    const long = `where do we keep ${"x".repeat(100_000)}`;

    await h.prompt("ses-1", long);
    await h.context("ses-1");

    const { items } = await h.list("ses-1");
    expect(items[0].query.length).toBeLessThanOrEqual(300);
    const title = (query: string) => callTitle({ mode: "search", query, items: items[0].items });
    expect(title(items[0].query)).toBe(title(long));

    await cleanup();
  });

  it("lists only the asked session and carries the enabled setting", async () => {
    let enabled = true;
    const h = createHarness({ memory: { isVisibleRecallEnabled: () => enabled } });
    const cleanup = await h.register();

    await h.prompt("ses-1", "first");
    await h.context("ses-1");
    await h.prompt("ses-2", "second");
    await h.context("ses-2");

    const one = await h.list("ses-1");
    expect(one.enabled).toBe(true);
    expect(one.items.map((item: any) => item.query)).toEqual(["first"]);
    expect((await h.list("ses-2")).items.map((item: any) => item.query)).toEqual(["second"]);
    expect((await h.list("ses-unknown")).items).toEqual([]);

    enabled = false;
    const off = await h.list("ses-1");
    expect(off.enabled).toBe(false);
    expect(off.items).toHaveLength(1);

    await cleanup();
  });

  it("keeps the latest summaries per session, oldest first, and bounds tracked sessions", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    const total = MAX_RECALL_SUMMARIES + 3;
    for (let i = 0; i < total; i++) {
      await h.prompt("ses-1", `q${i}`);
      await h.context("ses-1");
    }
    const queries = (await h.list("ses-1")).items.map((item: any) => item.query);
    expect(queries).toHaveLength(MAX_RECALL_SUMMARIES);
    expect(queries[0]).toBe("q3");
    expect(queries.at(-1)).toBe(`q${total - 1}`);

    const g = createHarness();
    const cleanupG = await g.register();
    for (let i = 0; i <= MAX_TRACKED_SESSIONS; i++) {
      await g.prompt(`ses-${i}`, "question");
      await g.context(`ses-${i}`);
    }
    expect((await g.list("ses-0")).items).toEqual([]);
    expect((await g.list(`ses-${MAX_TRACKED_SESSIONS}`)).items).toHaveLength(1);

    await cleanup();
    await cleanupG();
  });

  it("drops a deleted session's summaries", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = createHarness({
      gate,
      events: [{ type: "session.deleted", data: { sessionID: "ses-1" } }],
    });
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    await h.context("ses-1");
    expect((await h.list("ses-1")).items).toHaveLength(1);
    release();
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect((await h.list("ses-1")).items).toEqual([]);

    await cleanup();
  });

  it("never throws or blocks injection when the push or the registration fails", async () => {
    for (const rpc of [
      { emitFails: "reject" },
      { emitFails: "throw" },
      { registerFails: true },
      { noRpc: true },
    ] as RpcOptions[]) {
      const h = createHarness({ rpc });
      const cleanup = await h.register();

      await h.prompt("ses-1", "question");
      expect(await h.context("ses-1"), JSON.stringify(rpc)).toEqual([THREE_MEMORIES]);
      await Bun.sleep(0);

      await cleanup();
    }
  });

  it("injects the same bytes with and without reporting", async () => {
    const withReporting = createHarness();
    const without = createHarness({ rpc: { registerFails: true } });
    const a = await withReporting.register();
    const b = await without.register();

    await withReporting.prompt("ses-1", "question");
    await without.prompt("ses-1", "question");
    const first = await withReporting.context("ses-1");
    const second = await without.context("ses-1");

    expect(first).toEqual([THREE_MEMORIES]);
    expect(Buffer.from(first.join("\n"))).toEqual(Buffer.from(second.join("\n")));

    await a();
    await b();
  });
});
