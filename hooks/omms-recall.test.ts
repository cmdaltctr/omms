import { describe, expect, test } from "claude-code/testing";

// Run with `claude plugin test` (`bash scripts/test-claude-mod.sh`). `bun test`
// does not run this file: the engine's own test kit supplies `claude-code/testing`.

const INJECTED = `<omms-retrieval><memory_context><project_knowledge>
<memory id="mem_alpha" relevance="67%">
## Request
User asked to add a claude-adapter.
</memory>
<memory id="mem_beta" relevance="62%">
Embeddings use llama.cpp.
</memory>
</project_knowledge></memory_context></omms-retrieval>`;

const RESTORED = `<omms-retrieval>
## Restored Session Memory

### Memory 1 (mem_wal)
Use WAL mode

</omms-retrieval>`;

const OPENING = `<omms-retrieval>
<!--omms:opening query="project setup"-->
<memory_context><project_knowledge>
<memory id="mem_open" relevance="70%">
Set up the project with bun.
</memory>
</project_knowledge></memory_context></omms-retrieval>`;

const ROWS_OFF = INJECTED.replace("<omms-retrieval>", "<omms-retrieval>\n<!--omms:rows-off-->\n");

function textOf(node: any): string {
  if (typeof node === "string") return node;
  if (!node || !Array.isArray(node.children)) return "";
  return node.children.map(textOf).join("");
}

/** The engine's stand-in: a prompt enters as typed, and the reply text draws as one Text element. */
function world(on: any) {
  on("prompt.submit", (_$: any, e: any) => ({ text: e.text }));
  on("ui.render", { component: "AssistantMessage" }, (_$: any, e: any) => ({
    type: "Text",
    props: {},
    children: [e.props.text],
  }));
}

const injectRow = (text: string, door = "hook-context", agentId?: string) => ({
  door,
  uuid: `row-${Math.random()}`,
  origin: { kind: "settings-hook" },
  message: { type: "user", isMeta: true, role: "user", content: [{ type: "text", text }] },
  ...(agentId ? { agentId } : {}),
});

/** The person sends `text`, then OMMS's hook context for it arrives. */
async function prompt($: any, text: string, injected = INJECTED) {
  await $.prompt.submit({ text } as any);
  await $.session.append(injectRow(injected) as any);
}

async function mountReply($: any, requestId: string, isFirstOfReply = true) {
  return $.ui.mount({
    plugin: "omms",
    surface: "terminal",
    component: "AssistantMessage",
    requestId,
    props: { text: "Reply body", isFirstOfReply },
  });
}

describe("recall row", () => {
  test("a recall with no prompt of its own draws as mode=search with no query", async ($, on) => {
    world(on);
    await $.session.append(injectRow(INJECTED) as any);
    const text = textOf(await (await mountReply($, "reply-1")).drawn());
    expect(text).toContain("● memory [mode=search, limit=2]");
    expect(text).not.toContain("query=");
    expect(text).not.toContain("mode=recent");
  });

  test("a restored-session section draws as mode=restore", async ($, on) => {
    world(on);
    await $.session.append(injectRow(RESTORED) as any);
    const mounted = await mountReply($, "reply-1");
    expect(textOf(await mounted.drawn())).toContain("● memory [mode=restore, limit=1]");
    await mounted.press({ key: "omms-recall-reply-1-0" });
    const open = textOf(await mounted.drawn());
    expect(open).toContain("1. mem_wal Use WAL mode");
    expect(open).not.toContain("query:");
  });

  test("a prompt is the query of one search recall only", async ($, on) => {
    world(on);
    await prompt($, "first question");
    await $.session.append(injectRow(INJECTED) as any);
    const text = textOf(await (await mountReply($, "reply-1")).drawn());
    expect(text).toContain('query="first question", limit=2');
    expect(text).toContain("mode=search, limit=2]");
  });

  test("a prompt with no memories is not the query of a later compaction recall", async ($, on) => {
    world(on);
    await $.prompt.submit({ text: "unmatched question" } as any);
    await (await mountReply($, "reply-1")).drawn();
    await $.session.append(injectRow(RESTORED) as any);
    const text = textOf(await (await mountReply($, "reply-2")).drawn());
    expect(text).not.toContain("unmatched question");
    expect(text).toContain("● memory [mode=restore, limit=1]");
  });

  test("a prompt, a restored section, then the prompt's section draw one restore row and one search row", async ($, on) => {
    world(on);
    await $.prompt.submit({ text: "my first question" } as any);
    await $.session.append(injectRow(RESTORED) as any);
    await $.session.append(injectRow(INJECTED) as any);
    const text = textOf(await (await mountReply($, "reply-1")).drawn());
    expect(text).toContain("mode=restore, limit=1]");
    expect(text).toContain('mode=search, query="my first question", limit=2]');
    expect(text.indexOf("mode=restore")).toBeLessThan(text.indexOf("mode=search"));
    expect(text.match(/● memory/g)).toHaveLength(2);
  });

  test("an opening section draws as mode=opening after the search row and leaves the prompt for search", async ($, on) => {
    world(on);
    await $.prompt.submit({ text: "my first question" } as any);
    await $.session.append(injectRow(OPENING) as any);
    await $.session.append(injectRow(INJECTED) as any);
    const text = textOf(await (await mountReply($, "reply-1")).drawn());
    expect(text).toContain('mode=opening, query="project setup", limit=1]');
    expect(text).toContain('mode=search, query="my first question", limit=2]');
    // The opening section arrived first and did not use up the prompt.
    expect(text.match(/● memory/g)).toHaveLength(2);
  });

  test("one injected text with a prompt section and then an opening section draws search then opening", async ($, on) => {
    world(on);
    await $.prompt.submit({ text: "my first question" } as any);
    await $.session.append(injectRow(`${INJECTED}\n${OPENING}`) as any);
    const text = textOf(await (await mountReply($, "reply-1")).drawn());
    expect(text.indexOf("mode=search")).toBeGreaterThan(-1);
    expect(text.indexOf("mode=search")).toBeLessThan(text.indexOf("mode=opening"));
    expect(text).toContain('mode=search, query="my first question", limit=2]');
    expect(text).toContain('mode=opening, query="project setup", limit=1]');
  });

  test("a rows-off section draws no row and does not take the prompt", async ($, on) => {
    world(on);
    await $.prompt.submit({ text: "my first question" } as any);
    await $.session.append(injectRow(ROWS_OFF) as any);
    const alone = await mountReply($, "reply-1");
    expect(textOf(await alone.drawn())).toBe("Reply body");

    // The rows-off section did not use up the prompt: the next section takes it.
    await $.prompt.submit({ text: "second question" } as any);
    await $.session.append(injectRow(ROWS_OFF) as any);
    await $.session.append(injectRow(INJECTED) as any);
    const text = textOf(await (await mountReply($, "reply-2")).drawn());
    expect(text).toContain('mode=search, query="second question", limit=2]');
    expect(text.match(/● memory/g)).toHaveLength(1);
  });

  test("the first reply shows no mode=recent row", async ($, on) => {
    world(on);
    await prompt($, "my first question");
    await $.session.append(injectRow(RESTORED) as any);
    const text = textOf(await (await mountReply($, "reply-1")).drawn());
    expect(text).not.toContain("mode=recent");
  });

  test("a reply after a recall shows the count and the reply body", async ($, on) => {
    world(on);
    await prompt($, "how does the claude adapter recall?");
    const text = textOf(await (await mountReply($, "reply-1")).drawn());
    expect(text).toContain(
      '● memory [mode=search, query="how does the claude adapter recall?", limit=2]'
    );
    expect(text).toContain("Reply body");
    expect(text).not.toContain("claude-adapter");
  });

  test("pressing the row unfolds the memories with their ids, and pressing again folds them", async ($, on) => {
    world(on);
    await prompt($, "how does the claude adapter recall?");
    const mounted = await mountReply($, "reply-1");
    await mounted.press({ key: "omms-recall-reply-1-0" });
    const open = textOf(await mounted.drawn());
    expect(open).toContain("mode: search");
    expect(open).toContain("query: how does the claude adapter recall?");
    expect(open).toContain("limit: 2");
    expect(open).toContain("1. 67% mem_alpha User asked to add a claude-adapter.");
    expect(open).toContain("2. 62% mem_beta Embeddings use llama.cpp.");
    await mounted.press({ key: "omms-recall-reply-1-0" });
    expect(textOf(await mounted.drawn())).not.toContain("claude-adapter");
  });

  test("a reply with no recall draws unchanged", async ($, on) => {
    world(on);
    const mounted = await mountReply($, "reply-1");
    expect(textOf(await mounted.drawn())).toBe("Reply body");
  });

  test("a recall belongs to one reply: the next reply does not show it again", async ($, on) => {
    world(on);
    await prompt($, "first prompt");
    await mountReply($, "reply-1");
    const second = await mountReply($, "reply-2");
    expect(textOf(await second.drawn())).toBe("Reply body");
  });

  test("only the first block of a reply carries the row", async ($, on) => {
    world(on);
    await prompt($, "first prompt");
    const later = await mountReply($, "reply-1-block-2", false);
    expect(textOf(await later.drawn())).toBe("Reply body");
  });

  test("context that is not OMMS, or from another door or a subagent, adds nothing", async ($, on) => {
    world(on);
    await $.session.append(injectRow("some other hook context") as any);
    await $.session.append(injectRow(INJECTED, "note") as any);
    await $.session.append(injectRow(INJECTED, "hook-context", "agent-1") as any);
    const mounted = await mountReply($, "reply-1");
    expect(textOf(await mounted.drawn())).toBe("Reply body");
  });

  test("a recall, then a subagent section, then the main reply draws the main row once", async ($, on) => {
    world(on);
    await prompt($, "main question");
    await $.session.append(injectRow(INJECTED, "hook-context", "agent-1") as any);
    const text = textOf(await (await mountReply($, "reply-1")).drawn());
    expect(text.match(/● memory/g)).toHaveLength(1);
    expect(text).toContain('mode=search, query="main question", limit=2]');
  });
});
