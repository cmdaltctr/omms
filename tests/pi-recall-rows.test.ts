import { describe, expect, it, mock } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

const logged: Array<{ message: string; data: unknown }> = [];
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data: unknown) => logged.push({ message, data }),
}));

const {
  createPiRecallRows,
  MAX_RECALL_QUERY_CHARS,
  MAX_RECALL_ROWS,
  MAX_RECALL_SUMMARIES,
  RECALL_WIDGET_KEY,
} = await import("../src/adapters/pi/recall-rows.js");

const QUERY = "how did we handle om-pi-todo";
const THREE = [
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
].join("\n");
const COLLAPSED = `▸ ● memory [mode=search, query="${QUERY}", limit=3]`;

type WidgetCall = { key: string; content: unknown; placement: unknown };
const plainTheme = { fg: (_colour: string, text: string) => text };

function makeCtx(
  options: { mode?: string; sessionId?: string; setWidget?: (...args: unknown[]) => void } = {}
) {
  const calls: WidgetCall[] = [];
  const ctx = {
    mode: options.mode ?? "tui",
    hasUI: true,
    cwd: "/workspace",
    sessionManager: { getSessionId: () => options.sessionId ?? "pi-session-1" },
    ui: {
      setWidget:
        options.setWidget ??
        ((key: string, content: unknown, opts?: { placement?: string }) => {
          calls.push({ key, content, placement: opts?.placement });
        }),
    },
  };
  return { ctx: ctx as any, calls };
}

/** Lines the latest widget draws at `width`, or null when the latest call cleared it. */
function drawn(calls: WidgetCall[], width = 200, theme: unknown = plainTheme): string[] | null {
  const last = calls.at(-1);
  if (!last || last.content === undefined) return null;
  const factory = last.content as (tui: unknown, theme: unknown) => { render(w: number): string[] };
  return factory({}, theme).render(width);
}

function memories(count: number, headline = "Memory"): string {
  return Array.from(
    { length: count },
    (_, i) => `<memory id="m${i + 1}" relevance="${90 - i}%">\n${headline} ${i + 1}\n</memory>`
  ).join("\n");
}

describe("Pi recall rows: recording", () => {
  it("records one summary for a section with entries and draws one folded row", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, QUERY, THREE, true);

    expect(rows.summaries()).toHaveLength(1);
    expect(rows.summaries()[0]).toMatchObject({ mode: "search", query: QUERY, seq: 1 });
    expect(rows.summaries()[0]!.items).toHaveLength(3);
    expect(calls.at(-1)?.key).toBe(RECALL_WIDGET_KEY);
    expect(calls.at(-1)?.placement).toBe("aboveEditor");
    expect(drawn(calls)).toEqual([COLLAPSED]);
  });

  it("records nothing for a null section or a section without memory entries", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, QUERY, null, true);
    await rows.record(ctx, QUERY, "<memory_context>profile only</memory_context>", true);

    expect(rows.summaries()).toEqual([]);
    expect(calls).toEqual([]);
  });

  for (const mode of ["rpc", "json", "print"]) {
    it(`records and draws nothing in ${mode} mode`, async () => {
      const rows = createPiRecallRows();
      const { ctx, calls } = makeCtx({ mode });
      await rows.record(ctx, QUERY, THREE, true);
      await rows.toggleAll(ctx, true);
      rows.reset(ctx);

      expect(rows.summaries()).toEqual([]);
      expect(calls).toEqual([]);
    });
  }

  it("keeps only the latest 20 summaries with a rising sequence number", async () => {
    const rows = createPiRecallRows();
    const { ctx } = makeCtx();
    for (let i = 1; i <= 25; i++) await rows.record(ctx, `query ${i}`, THREE, true);

    expect(MAX_RECALL_SUMMARIES).toBe(20);
    expect(rows.summaries()).toHaveLength(20);
    expect(rows.summaries()[0]).toMatchObject({ query: "query 6", seq: 6 });
    expect(rows.summaries().at(-1)).toMatchObject({ query: "query 25", seq: 25 });
  });

  it("cuts the stored query to 300 characters", async () => {
    const rows = createPiRecallRows();
    const { ctx } = makeCtx();
    await rows.record(ctx, "q".repeat(900), THREE, true);

    expect(MAX_RECALL_QUERY_CHARS).toBe(300);
    expect(rows.summaries()[0]!.query).toHaveLength(300);
  });

  it("drops the summaries of an earlier session when another session records", async () => {
    const rows = createPiRecallRows();
    await rows.record(makeCtx({ sessionId: "a" }).ctx, "from a", THREE, true);
    const second = makeCtx({ sessionId: "b" });
    await rows.record(second.ctx, "from b", THREE, true);

    expect(rows.summaries().map((s) => s.query)).toEqual(["from b"]);
    expect(drawn(second.calls)).toHaveLength(1);
  });

  it("logs the session id, mode and count only, never the query or a headline", async () => {
    logged.length = 0;
    const rows = createPiRecallRows();
    await rows.record(makeCtx().ctx, QUERY, THREE, true);
    await rows.record(
      makeCtx({
        setWidget: () => {
          throw new Error("boom");
        },
      }).ctx,
      QUERY,
      THREE,
      true
    );

    const recorded = logged.filter((entry) => entry.message.includes("summary recorded"));
    expect(recorded).toHaveLength(2);
    expect(Object.keys(recorded[0]!.data as object).sort()).toEqual(["count", "mode", "sessionID"]);
    expect(recorded[0]!.data).toEqual({ sessionID: "pi-session-1", mode: "search", count: 3 });
    const text = JSON.stringify(logged);
    for (const secret of [QUERY, "Use WAL mode", "Prefer bun", "Keep files"]) {
      expect(text).not.toContain(secret);
    }
  });
});

const RESTORED = [
  "<omms-retrieval>",
  "## Restored Session Memory",
  "",
  "### Memory 1 (r1)",
  "Restored one",
  "",
  "### Memory 2 (r2)",
  "Restored two",
  "</omms-retrieval>",
].join("\n");

describe("Pi recall rows: opening and restore modes", () => {
  it("draws an opening row with the configured query, after the prompt's row", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, QUERY, THREE, true);
    await rows.record(ctx, "project setup", THREE, true, "opening");

    expect(rows.summaries().map((s) => s.mode)).toEqual(["search", "opening"]);
    expect(drawn(calls)).toEqual([
      COLLAPSED,
      '▸ ● memory [mode=opening, query="project setup", limit=3]',
    ]);
  });

  it("draws a restore row with a limit and no query", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, "ignored", RESTORED, true, "restore");

    expect(rows.summaries()[0]).toMatchObject({ mode: "restore", query: null });
    expect(drawn(calls)).toEqual(["▸ ● memory [mode=restore, limit=2]"]);
  });

  it("unfolds a restore row into its memories without a relevance", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, "", RESTORED, true, "restore");
    await rows.toggleAll(ctx, true);

    expect(drawn(calls)!.join("\n")).toContain("id=r1 Restored one");
  });

  for (const mode of ["opening", "restore"] as const) {
    it(`draws no ${mode} row outside the terminal mode`, async () => {
      const rows = createPiRecallRows();
      const { ctx, calls } = makeCtx({ mode: "rpc" });
      await rows.record(ctx, "project setup", mode === "restore" ? RESTORED : THREE, true, mode);

      expect(rows.summaries()).toEqual([]);
      expect(calls).toEqual([]);
    });

    it(`draws no ${mode} row when visible recall is off`, async () => {
      const rows = createPiRecallRows();
      const { ctx, calls } = makeCtx();
      await rows.record(ctx, "project setup", mode === "restore" ? RESTORED : THREE, false, mode);

      expect(drawn(calls)).toBeNull();
    });
  }

  it("logs the mode and count of an opening summary, never its query", async () => {
    logged.length = 0;
    const rows = createPiRecallRows();
    await rows.record(makeCtx().ctx, "secret opening query", THREE, true, "opening");

    const recorded = logged.find((entry) => entry.message.includes("summary recorded"));
    expect(recorded!.data).toEqual({ sessionID: "pi-session-1", mode: "opening", count: 3 });
    expect(JSON.stringify(logged)).not.toContain("secret opening query");
  });
});

describe("Pi recall rows: drawing", () => {
  it("shows only the latest 5 rows for 7 summaries", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    for (let i = 1; i <= 7; i++) await rows.record(ctx, `query ${i}`, THREE, true);

    const lines = drawn(calls)!;
    expect(MAX_RECALL_ROWS).toBe(5);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('query="query 3"');
    expect(lines[4]).toContain('query="query 7"');
  });

  it("unfolds a row into the shared unfold lines", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, QUERY, THREE, true);
    await rows.toggleAll(ctx, true);

    expect(drawn(calls)).toEqual([
      `▾ ● memory [mode=search, query="${QUERY}", limit=3]`,
      "  mode: search",
      `  query: ${QUERY}`,
      "  limit: 3",
      "  1. 91% id=m1 Use WAL mode",
      "  2. 80% id=m2 Prefer bun over npm",
      "  3. 55% id=m3 Keep files under 500 lines",
    ]);
  });

  it("cuts every folded and unfolded line to a width of 20, wide characters included", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(
      ctx,
      "数据库迁移怎么处理 " + QUERY,
      memories(3, "使用预写日志模式处理队列"),
      true
    );

    for (const lines of [drawn(calls, 20)!, (await rows.toggleAll(ctx, true), drawn(calls, 20)!)]) {
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
    }
  });

  it("clears the widget when visible recall is off but still records the summary", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, QUERY, THREE, true);
    await rows.record(ctx, QUERY, THREE, false);

    expect(rows.summaries()).toHaveLength(2);
    expect(calls.at(-1)).toEqual({
      key: RECALL_WIDGET_KEY,
      content: undefined,
      placement: undefined,
    });
  });
});

describe("Pi recall rows: folding", () => {
  it("unfolds every shown row, then folds them all when all are open", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, "first", THREE, true);
    await rows.record(ctx, "second", THREE, true);

    await rows.toggleAll(ctx, true);
    expect(drawn(calls)!.filter((line) => line.startsWith("▾"))).toHaveLength(2);

    await rows.toggleAll(ctx, true);
    expect(drawn(calls)).toEqual([
      '▸ ● memory [mode=search, query="first", limit=3]',
      '▸ ● memory [mode=search, query="second", limit=3]',
    ]);
  });

  it("keeps older rows unfolded and draws a new row folded", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, "first", THREE, true);
    await rows.toggleAll(ctx, true);
    await rows.record(ctx, "second", THREE, true);

    const titles = drawn(calls)!.filter((line) => line.includes("● memory"));
    expect(titles).toEqual([
      '▾ ● memory [mode=search, query="first", limit=3]',
      '▸ ● memory [mode=search, query="second", limit=3]',
    ]);
  });

  it("unfolds all when only some shown rows are open", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, "first", THREE, true);
    await rows.toggleAll(ctx, true);
    await rows.record(ctx, "second", THREE, true);
    await rows.toggleAll(ctx, true);

    expect(drawn(calls)!.filter((line) => line.startsWith("▾"))).toHaveLength(2);
  });

  it("reset drops summaries and fold state and clears the widget", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, "first", THREE, true);
    await rows.toggleAll(ctx, true);
    rows.reset(ctx);

    expect(rows.summaries()).toEqual([]);
    expect(calls.at(-1)?.content).toBeUndefined();

    await rows.record(ctx, "again", THREE, true);
    expect(rows.summaries()[0]!.seq).toBe(1);
    expect(drawn(calls)).toEqual(['▸ ● memory [mode=search, query="again", limit=3]']);
  });

  it("keeps fold state in memory only: a new instance starts folded and reads no host store", async () => {
    const touched: string[] = [];
    const sessionManager = new Proxy(
      { getSessionId: () => "pi-session-1" },
      {
        get(target, property) {
          touched.push(String(property));
          return Reflect.get(target, property);
        },
      }
    );
    const first = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    ctx.sessionManager = sessionManager;
    await first.record(ctx, "first", THREE, true);
    await first.toggleAll(ctx, true);
    expect(drawn(calls)![0]!.startsWith("▾")).toBe(true);

    const restarted = createPiRecallRows();
    await restarted.record(ctx, "first", THREE, true);
    expect(drawn(calls)).toEqual(['▸ ● memory [mode=search, query="first", limit=3]']);
    expect([...new Set(touched)]).toEqual(["getSessionId"]);
  });
});

describe("Pi recall rows: failure isolation", () => {
  it("never throws when setWidget throws", async () => {
    const rows = createPiRecallRows();
    const { ctx } = makeCtx({
      setWidget: () => {
        throw new Error("widget failed");
      },
    });

    await expect(rows.record(ctx, QUERY, THREE, true)).resolves.toBeUndefined();
    await expect(rows.toggleAll(ctx, true)).resolves.toBeUndefined();
    expect(() => rows.reset(ctx)).not.toThrow();
  });

  it("never throws when the session lookup throws", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    ctx.sessionManager = {
      getSessionId: () => {
        throw new Error("no session");
      },
    };

    await expect(rows.record(ctx, QUERY, THREE, true)).resolves.toBeUndefined();
    expect(rows.summaries()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("draws plain lines when the theme throws", async () => {
    const rows = createPiRecallRows();
    const { ctx, calls } = makeCtx();
    await rows.record(ctx, QUERY, THREE, true);
    const throwingTheme = {
      fg: () => {
        throw new Error("theme failed");
      },
    };

    expect(drawn(calls, 200, throwingTheme)).toEqual([COLLAPSED]);
  });
});
