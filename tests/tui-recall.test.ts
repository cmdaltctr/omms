import { describe, expect, it } from "bun:test";
import type { RecallSummary } from "../src/core/recall-summary.js";
import {
  MAX_ROWS,
  rowKeys,
  startTuiRecall,
  type FoldState,
} from "../src/adapters/opencode/tui-recall.js";

const search: RecallSummary = {
  mode: "search",
  query: "how did we handle om-pi-todo",
  items: [
    { relevance: 91, id: "mem_1", headline: "Pi todo list moved to a widget" },
    { relevance: 84, id: "mem_2", headline: "Todo tool schema" },
    { relevance: 70, headline: "No id here" },
  ],
};
const recent: RecallSummary = {
  mode: "recent",
  query: null,
  items: [{ relevance: 100, id: "mem_9", headline: "Latest note" }],
};

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

type Node = { tag: string; props: Record<string, any> };

/** Flatten a stub jsx tree into the text a terminal would show; hidden nodes are skipped. */
function dump(node: any): string[] {
  if (node == null || node === false) return [];
  if (typeof node === "string") return node === "" ? [] : [node];
  if (Array.isArray(node)) return node.flatMap(dump);
  if (node.props.visible === false) return [];
  return dump(node.props.children);
}

interface HostOptions {
  list?: (input: { sessionID: string }) => Promise<any>;
  rpc?: () => any;
  storeState?: FoldState;
  store?: (key: string, options: any) => any;
  slot?: () => any;
  jsx?: (tag: string, props: any) => any;
}

function makeHost(options: HostOptions = {}) {
  const calls: string[] = [];
  const pushHandlers: Array<(event: any) => void> = [];
  const dataHandlers: Array<(event: any) => void> = [];
  const commands: any[] = [];
  const removed: string[] = [];
  const slots: Array<{ append: string; render: (input: any) => any }> = [];
  const persisted: FoldState = options.storeState ?? { open: {} };
  const list =
    options.list ??
    (async ({ sessionID }: { sessionID: string }) => ({
      enabled: true,
      items: sessionID === "s2" ? [recent] : [search],
    }));
  const rpcClient = {
    list: async (input: { sessionID: string }) => {
      calls.push(input.sessionID);
      return list(input);
    },
    events: {
      on: (name: string, handler: (event: any) => void) => {
        if (name === "recalled") pushHandlers.push(handler);
        return () => removed.push("push");
      },
    },
  };
  const deps = {
    client: { rpc: options.rpc ?? (() => rpcClient) },
    data: {
      listen: (handler: (event: any) => void) => {
        dataHandlers.push(handler);
        return () => removed.push("data");
      },
    },
    ui: {
      slot:
        options.slot ??
        ((spec: any) => {
          slots.push(spec);
          return () => removed.push("slot");
        }),
    },
    keymap: {
      layer: (factory: () => any) => {
        commands.push(...factory().commands);
        return () => removed.push("keymap");
      },
    },
    storage: {
      store:
        options.store ??
        ((_key: string, _options: any) => [
          persisted,
          (change: (draft: FoldState) => void) => {
            change(persisted);
            return Promise.resolve();
          },
        ]),
    },
    createSignal: <T>(initial: T) => {
      let value = initial;
      return [
        () => value,
        (next: T | ((previous: T) => T)) => {
          value = typeof next === "function" ? (next as (p: T) => T)(value) : next;
        },
      ] as [() => T, (next: T | ((previous: T) => T)) => unknown];
    },
    jsx: options.jsx ?? ((tag: string, props: any): Node => ({ tag, props })),
    muted: () => "grey",
    debounceMs: 5,
  };
  const emit = (type: string, sessionID?: string) =>
    dataHandlers.forEach((handler) =>
      handler({ details: { type, data: sessionID ? { sessionID } : {} } })
    );
  const push = (sessionID: string) =>
    pushHandlers.forEach((handler) => handler({ data: { sessionID } }));
  const draw = (sessionID: string) => slots[0]!.render({ sessionID });
  /** All text shown for a session after it settles. */
  const shown = async (sessionID: string) => {
    const root = draw(sessionID);
    await settle();
    return dump(root);
  };
  return { deps, calls, emit, push, draw, shown, commands, removed, slots, persisted };
}

/** Press a row: find the box with onMouseDown whose first text starts with the title. */
function press(root: any, index = 0) {
  const boxes = (root.props.children as Node[]).filter((n) => n.props.onMouseDown);
  boxes[index]!.props.onMouseDown({});
}

describe("recall fold rows", () => {
  it("shows a collapsed search row and a collapsed recent row", async () => {
    const host = makeHost();
    startTuiRecall(host.deps);
    expect(await host.shown("s1")).toEqual([
      '▸ ● memory [mode=search, query="how did we handle om-pi-todo", limit=3]',
    ]);
    expect(await host.shown("s2")).toEqual(["▸ ● memory [mode=recent, limit=1]"]);
  });

  it("unfolds on press and folds again", async () => {
    const host = makeHost();
    startTuiRecall(host.deps);
    const root: any = host.draw("s1");
    await settle();
    press(root);
    expect(dump(root)).toEqual([
      '▾ ● memory [mode=search, query="how did we handle om-pi-todo", limit=3]',
      [
        "  mode: search",
        "  query: how did we handle om-pi-todo",
        "  limit: 3",
        "  1. 91% id=mem_1 Pi todo list moved to a widget",
        "  2. 84% id=mem_2 Todo tool schema",
        "  3. 70% No id here",
      ].join("\n"),
    ]);
    press(root);
    expect(dump(root)).toEqual([
      '▸ ● memory [mode=search, query="how did we handle om-pi-todo", limit=3]',
    ]);
  });

  it("draws nothing when the reply says visible recall is off", async () => {
    const host = makeHost({ list: async () => ({ enabled: false, items: [search] }) });
    startTuiRecall(host.deps);
    expect(await host.shown("s1")).toEqual([]);
  });

  it("draws nothing when the reply has no items", async () => {
    const host = makeHost({ list: async () => ({ enabled: true, items: [] }) });
    startTuiRecall(host.deps);
    expect(await host.shown("s1")).toEqual([]);
  });

  it("draws nothing when the RPC call rejects, and again once it recovers", async () => {
    let fail = true;
    const host = makeHost({
      list: async () => {
        if (fail) throw new Error("Unknown RPC");
        return { enabled: true, items: [search] };
      },
    });
    startTuiRecall(host.deps);
    expect(await host.shown("s1")).toEqual([]);
    fail = false;
    host.emit("session.step.started", "s1");
    await settle();
    expect(dump(host.draw("s1"))).toHaveLength(1);
  });

  it("draws nothing and throws nothing when the RPC handler is missing", async () => {
    for (const rpc of [
      () => {
        throw new Error("no rpc domain");
      },
      () => undefined,
    ]) {
      const host = makeHost({ rpc });
      expect(() => startTuiRecall(host.deps)).not.toThrow();
      expect(await host.shown("s1")).toEqual([]);
      expect(() => host.emit("session.step.started", "s1")).not.toThrow();
    }
  });

  it("collapses an event burst into a few list calls", async () => {
    const host = makeHost();
    startTuiRecall(host.deps);
    host.draw("s1");
    await settle();
    host.calls.length = 0;
    for (let i = 0; i < 30; i++) host.emit("session.step.started", "s1");
    await settle(60);
    expect(host.calls.length).toBeGreaterThanOrEqual(1);
    expect(host.calls.length).toBeLessThanOrEqual(2);
  });

  it("does not pull on streaming, part, message, inbox or instruction events", async () => {
    const host = makeHost();
    startTuiRecall(host.deps);
    host.draw("s1");
    await settle();
    host.calls.length = 0;
    const streaming = [
      "session.text.delta",
      "session.reasoning.delta",
      "session.tool.input.delta",
      "session.tool.progress",
      "session.message.content.updated",
      "session.step.streamed",
      "session.usage.updated",
      "session.inbox.enqueued",
      "session.inbox.delivered",
      "session.instructions.updated",
    ];
    for (let i = 0; i < 50; i++) host.emit(streaming[i % streaming.length]!, "s1");
    await settle(60);
    expect(host.calls).toEqual([]);
  });

  it.each([
    "session.created",
    "session.viewed",
    "session.execution.started",
    "session.step.started",
    "session.step.ended",
    "session.execution.succeeded",
    "session.step.failed",
    "session.execution.failed",
  ])("pulls for a tracked session on %s", async (type) => {
    const host = makeHost();
    startTuiRecall(host.deps);
    host.draw("s1");
    await settle();
    host.calls.length = 0;
    host.emit(type, "s1");
    await settle(40);
    expect(host.calls).toEqual(["s1"]);
  });

  it("ignores events that are not session events or name no drawn session", async () => {
    const host = makeHost();
    startTuiRecall(host.deps);
    host.draw("s1");
    await settle();
    host.calls.length = 0;
    host.emit("model.updated", "s1");
    host.emit("session.step.started");
    host.emit("session.step.started", "other");
    await settle(40);
    expect(host.calls).toEqual([]);
  });

  it("shows the rows of the session in view after a switch", async () => {
    const host = makeHost();
    startTuiRecall(host.deps);
    await host.shown("s1");
    expect(await host.shown("s2")).toEqual(["▸ ● memory [mode=recent, limit=1]"]);
    expect(dump(host.draw("s1"))[0]).toContain("mode=search");
  });

  it("refreshes on the pushed recalled event, and works with push absent", async () => {
    let items = [search];
    const host = makeHost({ list: async () => ({ enabled: true, items }) });
    startTuiRecall(host.deps);
    const root = host.draw("s1");
    await settle();
    expect(dump(root)).toHaveLength(1);
    items = [search, recent];
    host.push("s1");
    await settle();
    expect(dump(root)).toHaveLength(2);
    // Without any push or data event the first pull at render already drew the row.
    const quiet = makeHost();
    startTuiRecall(quiet.deps);
    expect(await quiet.shown("s1")).toHaveLength(1);
  });

  it("shows only the latest rows", async () => {
    const many = Array.from({ length: MAX_ROWS + 3 }, (_, i) => ({
      ...recent,
      items: [{ relevance: 50, id: `m${i}`, headline: `h${i}` }],
    }));
    const host = makeHost({ list: async () => ({ enabled: true, items: many }) });
    startTuiRecall(host.deps);
    const root: any = host.draw("s1");
    await settle();
    expect(dump(root)).toHaveLength(MAX_ROWS);
    press(root, MAX_ROWS - 1);
    expect(dump(root).join("\n")).toContain(`id=m${MAX_ROWS + 2}`);
    expect(dump(root).join("\n")).not.toContain("id=m0");
  });

  it("keeps a row open by its sequence number when the oldest identical summary drops", async () => {
    let seqs = [1, 2, 3];
    const host = makeHost({
      list: async () => ({
        enabled: true,
        items: seqs.map((seq) => ({ ...recent, seq })),
      }),
    });
    startTuiRecall(host.deps);
    const root: any = host.draw("s1");
    await settle();
    press(root, 2);
    const open = () => (root.props.children as Node[]).map((row) => dump(row).length > 1);
    expect(open()).toEqual([false, false, true]);

    seqs = [2, 3, 4];
    host.push("s1");
    await settle();
    expect(open()).toEqual([false, true, false]);
  });

  it("toggles every row of the session in view with /omms-recall", async () => {
    const host = makeHost({
      list: async () => ({ enabled: true, items: [search, recent] }),
    });
    startTuiRecall(host.deps);
    const root = host.draw("s1");
    await settle();
    expect(host.commands).toHaveLength(1);
    expect(host.commands[0].slash.name).toBe("omms-recall");
    expect(host.commands[0].title).toBe("Toggle OMMS recall rows");
    host.commands[0].run();
    expect(dump(root).filter((line) => line.startsWith("▾"))).toHaveLength(2);
    host.commands[0].run();
    expect(dump(root).filter((line) => line.startsWith("▾"))).toHaveLength(0);
  });

  it("follows a session id that changes while the claim stays mounted", async () => {
    const host = makeHost();
    startTuiRecall(host.deps);
    // The host calls render once and updates the input in place (reactive props).
    const input = { sessionID: "s1" };
    const root: any = host.slots[0].render(input);
    await settle();
    expect(dump(root)[0]).toContain("mode=search");
    host.calls.length = 0;

    input.sessionID = "s2";
    expect(dump(root)).toEqual([]);
    await settle();
    expect(host.calls).toEqual(["s2"]);
    expect(dump(root)).toEqual(["▸ ● memory [mode=recent, limit=1]"]);

    // Data events for the new id are tracked.
    host.calls.length = 0;
    host.emit("session.step.started", "s2");
    await settle(40);
    expect(host.calls).toEqual(["s2"]);
  });

  it("does not pull again when a repaint keeps the same session id", async () => {
    const host = makeHost();
    startTuiRecall(host.deps);
    const input = { sessionID: "s1" };
    const root: any = host.slots[0].render(input);
    await settle();
    host.calls.length = 0;
    dump(root);
    dump(root);
    await settle(40);
    expect(host.calls).toEqual([]);
  });

  it("registers the keymap layer on every render, so a remount restores the command", async () => {
    const host = makeHost();
    startTuiRecall(host.deps);
    host.draw("s1");
    expect(host.commands).toHaveLength(1);
    host.draw("s1");
    host.draw("s2");
    expect(host.commands).toHaveLength(3);
    expect(host.commands.every((command) => command.slash.name === "omms-recall")).toBe(true);
  });

  it("keeps a row open across a restart through storage", async () => {
    const storeState: FoldState = { open: {} };
    const first = makeHost({ storeState });
    const stop = startTuiRecall(first.deps);
    const root: any = first.draw("s1");
    await settle();
    press(root);
    stop();
    expect(Object.keys(storeState.open)).toEqual(rowKeys("s1", [search]));

    const second = makeHost({ storeState });
    startTuiRecall(second.deps);
    const lines = await second.shown("s1");
    expect(lines[0]).toStartWith("▾ ●");
    expect(lines[1]).toContain("limit: 3");

    // Folding removes the entry again.
    const again: any = second.draw("s1");
    await settle();
    press(again);
    expect(storeState.open).toEqual({});
  });

  it("stops cleanly: every hook is released", async () => {
    const host = makeHost();
    const stop = startTuiRecall(host.deps);
    host.draw("s1");
    stop();
    expect(host.removed.sort()).toEqual(["data", "keymap", "push", "slot"]);
    host.calls.length = 0;
    host.emit("session.step.started", "s1");
    await settle(40);
    expect(host.calls).toEqual([]);
  });
});

describe("recall rows never throw into the host", () => {
  it("keeps drawing when storage fails in any way", async () => {
    const failures: Array<HostOptions["store"]> = [
      () => {
        throw new Error("no storage");
      },
      () => [{ open: {} }, () => Promise.reject(new Error("write failed"))],
      () => [
        { open: {} },
        () => {
          throw new Error("update threw");
        },
      ],
    ];
    for (const store of failures) {
      const host = makeHost({ store });
      expect(() => startTuiRecall(host.deps)).not.toThrow();
      const root: any = host.draw("s1");
      await settle();
      expect(dump(root)).toHaveLength(1);
      expect(() => press(root)).not.toThrow();
      await settle();
      expect(dump(root)[0]).toStartWith("▾");
    }
  });

  it("survives a slot, keymap, data, push or jsx failure", async () => {
    const boom = () => {
      throw new Error("host broke");
    };
    const slotHost = makeHost({ slot: boom });
    expect(() => startTuiRecall(slotHost.deps)).not.toThrow();

    const keymapHost = makeHost();
    keymapHost.deps.keymap.layer = boom;
    startTuiRecall(keymapHost.deps);
    expect(await keymapHost.shown("s1")).toHaveLength(1);

    const dataHost = makeHost();
    dataHost.deps.data.listen = boom;
    expect(() => startTuiRecall(dataHost.deps)).not.toThrow();

    const jsxHost = makeHost({ jsx: boom });
    startTuiRecall(jsxHost.deps);
    expect(() => jsxHost.draw("s1")).not.toThrow();
    expect(jsxHost.draw("s1")).toBeNull();
  });

  it("ignores malformed items in a reply", async () => {
    const host = makeHost({
      list: async () => ({ enabled: true, items: [null, { mode: "x" }, 5, search] }),
    });
    startTuiRecall(host.deps);
    expect(await host.shown("s1")).toHaveLength(1);
  });
});

describe("row keys", () => {
  it("survive older entries dropping out and differ for identical summaries", () => {
    const [a, b] = rowKeys("s1", [search, recent]);
    expect(a).not.toBe(b);
    expect(rowKeys("s1", [recent])[0]).toBe(b);
    expect(rowKeys("s2", [recent])[0]).not.toBe(b);
    const [x, y] = rowKeys("s1", [recent, recent]);
    expect(x).not.toBe(y);
  });

  it("use the sequence number when present and ignore the position", () => {
    const keys = rowKeys("s1", [
      { ...recent, seq: 7 },
      { ...recent, seq: 9 },
    ]);
    expect(keys).toEqual(["s1:7", "s1:9"]);
    expect(rowKeys("s1", [{ ...recent, seq: 9 }])).toEqual(["s1:9"]);
  });

  it("fall back to the hash when seq is missing or not a number", () => {
    const [x, y] = rowKeys("s1", [recent, { ...recent, seq: "3" as unknown as number }]);
    expect(x).toMatch(/^s1:[0-9a-f]+$/);
    expect(y).toBe(`${x}#1`);
  });
});
