import { describe, expect, it } from "bun:test";
import { registerV2Adapter } from "../src/v2/adapter.js";
import type { V2MemoryBridge } from "../src/v2/memory-bridge.js";
import { utf8ByteLength } from "../src/utils/context-limit.js";

// Task 4.1/4.2 for OpenCode v2: the adapter captures one byte budget per
// request before the prompt's async retrieval starts, the restored section
// shares that same total at context time, a config edit mid-flight cannot
// change the request already in progress, and the next request uses the new
// value. The bridge is faked with exact-size sections so the arithmetic is
// deterministic; the packing itself is covered by the shared packing tests.

const OPEN = "<omms-retrieval>\n";
const CLOSE = "\n</omms-retrieval>";

/** An `omms-retrieval`-wrapped section of exactly `totalBytes` ASCII bytes. */
function wrappedSectionOfExactly(totalBytes: number): string | null {
  if (totalBytes <= 0) return null;
  const body = Math.max(0, totalBytes - OPEN.length - CLOSE.length);
  return `${OPEN}${"r".repeat(body)}${CLOSE}`;
}

/** A restored-memory section of exactly `totalBytes` ASCII bytes. */
function restoredSectionOfExactly(totalBytes: number): string | null {
  if (totalBytes <= 0) return null;
  return `## Restored Session Memory\n\n${"y".repeat(Math.max(0, totalBytes - 28))}`;
}

interface Harness {
  register: () => Promise<() => Promise<void>>;
  prompt: (sessionID: string, text: string) => Promise<void>;
  /** `history` lists user messages from before this process saw the session (a resumed session). */
  context: (sessionID: string, history?: string[]) => Promise<string[]>;
  compaction: (sessionID: string) => Promise<void>;
  setRetrievalMaxTokens: (tokens: number) => void;
  seen: {
    retrieveBudgets: number[];
    restoreBudgets: number[];
    snapshots: number;
  };
}

function createHarness(
  options: {
    retrievalBytes?: number;
    openingBytes?: number;
    restoredBytes?: number;
    onSnapshot?: () => void;
    recordPrompt?: () => Promise<void>;
    canInject?: () => boolean;
    canCompact?: () => boolean;
  } = {}
): Harness {
  const retrievalBytes = options.retrievalBytes ?? Number.MAX_SAFE_INTEGER;
  const restoredBytes = options.restoredBytes ?? Number.MAX_SAFE_INTEGER;
  const state = { retrievalMaxTokens: 2000 };
  const lastMessage = new Map<string, string>();
  const seen = {
    retrieveBudgets: [] as number[],
    restoreBudgets: [] as number[],
    snapshots: 0,
  };

  const memory: V2MemoryBridge = {
    retrievalTimeoutMs: 5_000,
    isConfigured: () => true,
    isInjectionEnabled: options.canInject ?? (() => true),
    isCompactionEnabled: options.canCompact ?? (() => true),
    isVisibleRecallEnabled: () => true,
    isSubagentMemoryEnabled: () => true,
    isInternalPrompt: () => false,
    recordPrompt: options.recordPrompt ?? (async () => {}),
    snapshotRequestBudget() {
      seen.snapshots++;
      options.onSnapshot?.();
      return state.retrievalMaxTokens * 4;
    },
    async retrieve(_prompt, _sessionID, budgetBytes) {
      seen.retrieveBudgets.push(budgetBytes);
      return wrappedSectionOfExactly(Math.min(retrievalBytes, budgetBytes));
    },
    // The opening section is packed with what the prompt section leaves of the same budget.
    async retrieveFirstPrompt(prompt, sessionID, budgetBytes) {
      const promptSection = await memory.retrieve(prompt, sessionID, budgetBytes);
      const left = budgetBytes - utf8ByteLength(promptSection ?? "");
      const openingSection = options.openingBytes
        ? wrappedSectionOfExactly(Math.min(options.openingBytes, left))
        : null;
      return { promptSection, openingSection, openingQuery: openingSection ? "opening" : null };
    },
    async restoreSession() {
      return [{ memory: "Use WAL mode", tags: [] }];
    },
    formatRestoredSession(_memories, budgetBytes) {
      seen.restoreBudgets.push(budgetBytes);
      return restoredSectionOfExactly(Math.min(restoredBytes, budgetBytes));
    },
  };

  const hooks = new Map<string, (event: any) => Promise<void>>();
  const ctx = {
    location: { directory: "/workspace/project", project: { directory: "/workspace/project" } },
    tool: { transform: async () => {} },
    session: {
      hook: async (name: string, callback: (event: any) => Promise<void>) => {
        hooks.set(name, callback);
      },
      get: async () => ({}),
      synthetic: async () => {},
      prompt: async () => {},
    },
    event: {
      // The adapter only drains the subscription at cleanup; yield nothing.
      async *subscribe({ signal }: { signal: AbortSignal }) {
        yield null;
        if (!signal.aborted) {
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true })
          );
        }
      },
    },
  } as any;

  return {
    register: () => registerV2Adapter(ctx, minimalLegacy(), memory),
    prompt: (sessionID, text) => {
      lastMessage.set(sessionID, `msg-${text}`);
      return hooks.get("prompt")!({ sessionID, messageID: `msg-${text}`, prompt: { text } });
    },
    context: async (sessionID, history = []) => {
      const event = {
        sessionID,
        model: { providerID: "anthropic", id: "claude" },
        system: [] as Array<{ type: string; text: string }>,
        messages: [...history, lastMessage.get(sessionID) ?? `msg-${sessionID}`].map((id) => ({
          id,
          role: "user",
        })),
      };
      await hooks.get("context")!(event);
      return event.system.map((part) => part.text);
    },
    compaction: (sessionID) =>
      hooks.get("compaction")!({
        sessionID,
        model: { providerID: "anthropic", id: "claude" },
        system: [],
      }),
    setRetrievalMaxTokens: (tokens) => {
      state.retrievalMaxTokens = tokens;
    },
    seen,
  };
}

function minimalLegacy() {
  return {
    tool: { memory: { description: "Memory tool", execute: async () => "{}" } },
    "chat.params": async () => {},
    event: async () => {},
    dispose: async () => {},
  };
}

describe("OpenCode v2 request budget (memory-context-controls 4.1/4.2)", () => {
  it("captures the budget before retrieval and keeps it for the whole request", async () => {
    const h = createHarness();
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    expect(h.seen.retrieveBudgets).toEqual([8_000]);

    // A config edit after the search started must not reach this request.
    h.setRetrievalMaxTokens(1000);
    const system = await h.context("ses-1");
    expect(system).toHaveLength(1);
    expect(utf8ByteLength(system[0]!)).toBeLessThanOrEqual(8_000);
    // No restored section exists yet, so no restore budget was needed.
    expect(h.seen.restoreBudgets).toEqual([]);

    // The next request uses the new value.
    await h.prompt("ses-1", "next question");
    expect(h.seen.retrieveBudgets).toEqual([8_000, 4_000]);

    await cleanup();
  });

  it("shares one total between the retrieval and restored sections", async () => {
    const h = createHarness({ retrievalBytes: 5_000, restoredBytes: 6_000 });
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    await h.compaction("ses-1");
    const system = await h.context("ses-1");

    expect(system).toHaveLength(2);
    expect(utf8ByteLength(system[0]!)).toBe(5_000);
    // The restored section gets exactly what the retrieval left of the
    // request's captured 8,000-byte total.
    expect(h.seen.restoreBudgets).toEqual([8_000 - 5_000]);
    expect(utf8ByteLength(system[1]!)).toBe(3_000);
    expect(utf8ByteLength(system.join(""))).toBeLessThanOrEqual(8_000);

    await cleanup();
  });

  it("keeps the prompt-captured total when compaction lands between prompt and context", async () => {
    const h = createHarness({ retrievalBytes: 4_000, restoredBytes: 6_000 });
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    // The compaction completes after the prompt's budget was captured.
    h.setRetrievalMaxTokens(500);
    await h.compaction("ses-1");
    const system = await h.context("ses-1");

    expect(h.seen.restoreBudgets).toEqual([8_000 - 4_000]);
    expect(utf8ByteLength(system.join(""))).toBeLessThanOrEqual(8_000);

    await cleanup();
  });

  it("takes a fresh budget for a restored-only request", async () => {
    const h = createHarness({ restoredBytes: 6_000 });
    const cleanup = await h.register();

    await h.compaction("ses-1");
    const snapshotsBefore = h.seen.snapshots;
    h.setRetrievalMaxTokens(600);
    const system = await h.context("ses-1");

    expect(h.seen.snapshots).toBe(snapshotsBefore + 1);
    expect(h.seen.restoreBudgets).toEqual([2_400]);
    expect(utf8ByteLength(system[0]!)).toBeLessThanOrEqual(2_400);

    await cleanup();
  });

  it("snapshots a restored-only budget before recording an admitted prompt", async () => {
    let finishRecording!: () => void;
    const blocked = new Promise<void>((resolve) => {
      finishRecording = resolve;
    });
    let recordingStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      recordingStarted = resolve;
    });
    const h = createHarness({
      canInject: () => false,
      recordPrompt: async () => {
        recordingStarted();
        await blocked;
      },
    });
    const cleanup = await h.register();
    try {
      await h.prompt("ses-1", "ses-1");
      await h.compaction("ses-1");
      const first = h.context("ses-1");
      await started;
      h.setRetrievalMaxTokens(1000);
      finishRecording();
      await first;
      await h.context("ses-1");
      expect(h.seen.restoreBudgets).toEqual([8000, 4000]);
    } finally {
      finishRecording();
      await cleanup();
    }
  });

  it("refreshes config before the prompt injection gate", async () => {
    const order: string[] = [];
    const h = createHarness({
      onSnapshot: () => {
        order.push("refresh");
      },
      canInject: () => {
        order.push("injection-gate");
        return true;
      },
    });
    const cleanup = await h.register();
    try {
      await h.prompt("ses-1", "question");
      expect(order.indexOf("refresh")).toBeLessThan(order.indexOf("injection-gate"));
    } finally {
      await cleanup();
    }
  });

  it("refreshes config before the compaction gate", async () => {
    const order: string[] = [];
    const h = createHarness({
      onSnapshot: () => {
        order.push("refresh");
      },
      canCompact: () => {
        order.push("compaction-gate");
        return true;
      },
    });
    const cleanup = await h.register();
    try {
      await h.compaction("ses-1");
      expect(order.indexOf("refresh")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("refresh")).toBeLessThan(order.indexOf("compaction-gate"));
    } finally {
      await cleanup();
    }
  });

  it("gives the restored section the whole budget when retrieval finds nothing", async () => {
    const h = createHarness({ retrievalBytes: 0, restoredBytes: 6_000 });
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    await h.compaction("ses-1");
    const system = await h.context("ses-1");

    expect(system).toHaveLength(1);
    expect(h.seen.restoreBudgets).toEqual([8_000]);
    expect(utf8ByteLength(system[0]!)).toBeLessThanOrEqual(8_000);

    await cleanup();
  });

  it("emits no restored section when the retrieval used the whole budget", async () => {
    const h = createHarness({ retrievalBytes: 8_000, restoredBytes: 6_000 });
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    await h.compaction("ses-1");
    const system = await h.context("ses-1");

    expect(system).toHaveLength(1);
    expect(h.seen.restoreBudgets[0]).toBeLessThanOrEqual(0);
    expect(system[0]).not.toBe("");

    await cleanup();
  });
  it("keeps the prompt, opening and restored sections within one request budget", async () => {
    const h = createHarness({ retrievalBytes: 3_000, openingBytes: 2_500, restoredBytes: 6_000 });
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    await h.compaction("ses-1");
    const system = await h.context("ses-1");

    expect(system).toHaveLength(3);
    expect(utf8ByteLength(system[0]!)).toBe(3_000);
    // The opening section is packed with what the prompt section left of the 8,000 total.
    expect(utf8ByteLength(system[1]!)).toBe(2_500);
    // The restored section gets what both left.
    expect(h.seen.restoreBudgets).toEqual([8_000 - 3_000 - 2_500]);
    expect(utf8ByteLength(system.join(""))).toBeLessThanOrEqual(8_000);

    await cleanup();
  });

  it("gives the restored section of a resumed session what the prompt section left, with no opening section", async () => {
    const h = createHarness({ retrievalBytes: 3_000, openingBytes: 2_500, restoredBytes: 6_000 });
    const cleanup = await h.register();

    await h.prompt("ses-1", "question");
    const system = await h.context("ses-1", ["msg-old"]);

    expect(system).toHaveLength(2);
    expect(h.seen.restoreBudgets).toEqual([8_000 - 3_000]);
    expect(utf8ByteLength(system.join(""))).toBeLessThanOrEqual(8_000);

    await cleanup();
  });
});
