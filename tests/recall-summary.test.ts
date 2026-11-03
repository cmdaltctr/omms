import { describe, expect, it } from "bun:test";

import {
  buildRecallSummary,
  callTitle,
  headline,
  queryLine,
  unfoldLines,
  type RecallSummary,
} from "../src/core/recall-summary.js";

// Same shape `formatContextForPrompt` emits: header, optional profile, then memories with an id.
const SECTION = `<memory_context>
The following block is reference context injected from the memory system.

<user_profile>
Prefers British English.
</user_profile>
<project_knowledge>
<memory id="mem_aaa" relevance="67%">
## Request
User asked to add a claude-adapter.

## Outcome
Started.
</memory>
<memory id="mem_bbb" relevance="62%">
OMMS global embeddings use llama.cpp through the Llama app.
</memory>
<memory relevance="41%">
A memory without an id.
</memory>
</project_knowledge>
</memory_context>`;

const items = [
  { relevance: 80, headline: "a" },
  { relevance: 70, headline: "b" },
];

describe("buildRecallSummary", () => {
  it("lists each memory with relevance, id and a one-line headline", () => {
    expect(buildRecallSummary(SECTION, "search", "how did we handle om-pi-todo")).toEqual({
      mode: "search",
      query: "how did we handle om-pi-todo",
      items: [
        { relevance: 67, id: "mem_aaa", headline: "User asked to add a claude-adapter." },
        {
          relevance: 62,
          id: "mem_bbb",
          headline: "OMMS global embeddings use llama.cpp through the Llama app.",
        },
        { relevance: 41, headline: "A memory without an id." },
      ],
    });
  });

  it("leaves the id key out when the memory has none", () => {
    const summary = buildRecallSummary(SECTION, "recent", null);
    expect("id" in summary!.items[2]!).toBe(false);
  });

  it("forces the query to null in recent mode", () => {
    expect(buildRecallSummary(SECTION, "recent", "ignored")?.query).toBeNull();
  });

  it("reads a section wrapped in the omms-retrieval tag", () => {
    const wrapped = `<omms-retrieval>\n${SECTION}\n</omms-retrieval>`;
    expect(buildRecallSummary(wrapped, "search", "q")?.items).toHaveLength(3);
  });

  it("returns null when the section holds no memory", () => {
    expect(buildRecallSummary("", "search", "q")).toBeNull();
    expect(buildRecallSummary("plain hook context", "search", "q")).toBeNull();
    expect(
      buildRecallSummary(
        "<memory_context>\n<user_profile>\nOnly a profile.\n</user_profile>\n</memory_context>",
        "search",
        "q"
      )
    ).toBeNull();
  });

  it("keeps memories when the block was cut short and left tags open", () => {
    const cut =
      '<omms-retrieval><project_knowledge><memory id="m1" relevance="80%">\nFirst fact.\n<memory relevance="70%">\nSecond fact.';
    expect(buildRecallSummary(cut, "search", "q")?.items).toEqual([
      { relevance: 80, id: "m1", headline: "First fact." },
      { relevance: 70, headline: "Second fact." },
    ]);
  });

  it("keeps a memory shortened with the truncation marker", () => {
    const shortened =
      '<project_knowledge>\n<memory id="m1" relevance="55%">\nBig fact.\n[... truncated ...]\n';
    expect(buildRecallSummary(shortened, "search", "q")?.items).toEqual([
      { relevance: 55, id: "m1", headline: "Big fact." },
    ]);
  });

  it("reads a session-start block and a prompt block in one text", () => {
    expect(buildRecallSummary(`${SECTION}\n${SECTION}`, "search", "q")?.items).toHaveLength(6);
  });

  it("keeps one item when a memory quotes the memory tag in its text", () => {
    const section = `<project_knowledge>
<memory id="mem_q1" relevance="90%">
Fix ids in the section.
It emits <memory relevance="73%"> without ids when the memory has none.
</memory>
<memory id="mem_q2" relevance="60%">
Second memory.
</memory>
</project_knowledge>`;
    const summary = buildRecallSummary(section, "search", "q");
    expect(summary?.items.map((item) => item.id)).toEqual(["mem_q1", "mem_q2"]);
    expect(summary?.items[0]?.headline).toBe("Fix ids in the section.");
  });

  it("skips a memory whose body is empty", () => {
    const empty =
      '<memory relevance="90%">\n\n</memory>\n<memory relevance="50%">\nKept.\n</memory>';
    expect(buildRecallSummary(empty, "search", "q")?.items).toEqual([
      { relevance: 50, headline: "Kept." },
    ]);
  });
});

describe("headline", () => {
  it("takes the first line under ## Request", () => {
    expect(headline("## Request\nAdd a thing.\n\n## Outcome\nDone.")).toBe("Add a thing.");
  });

  it("skips blank lines between the heading and its text", () => {
    expect(headline("## Request\n\n  Add a thing.\n")).toBe("Add a thing.");
  });

  it("takes the first non-empty line when there is no ## Request", () => {
    expect(headline("\n\nFirst line.\nSecond line.")).toBe("First line.");
  });

  it("returns an empty string for an empty body", () => {
    expect(headline("")).toBe("");
  });

  it("cuts a long line to 140 characters with an ellipsis", () => {
    const cut = headline("x".repeat(300));
    expect(cut).toHaveLength(140);
    expect(cut.endsWith("...")).toBe(true);
  });

  it("leaves a line of exactly 140 characters alone", () => {
    expect(headline("y".repeat(140))).toBe("y".repeat(140));
  });
});

describe("queryLine", () => {
  it("joins a multi-line query on one line", () => {
    expect(queryLine("a\n\n  b")).toBe("a b");
  });

  it("cuts to 60 characters by default", () => {
    const cut = queryLine("x".repeat(100));
    expect(cut).toHaveLength(60);
    expect(cut).toBe(`${"x".repeat(57)}...`);
  });

  it("leaves a query of exactly 60 characters alone", () => {
    expect(queryLine("z".repeat(60))).toBe("z".repeat(60));
  });

  it("honours a custom limit", () => {
    expect(queryLine("x".repeat(400), 300)).toHaveLength(300);
  });
});

describe("callTitle", () => {
  it("names the mode, query and limit for a search", () => {
    const summary: RecallSummary = {
      mode: "search",
      query: "how did we handle om-pi-todo",
      items: [...items, { relevance: 60, headline: "c" }],
    };
    expect(callTitle(summary)).toBe(
      'memory [mode=search, query="how did we handle om-pi-todo", limit=3]'
    );
  });

  it("leaves out the query for a recent recall", () => {
    expect(callTitle({ mode: "recent", query: null, items })).toBe("memory [mode=recent, limit=2]");
  });

  it("cuts a long, multi-line query to one 60-character line", () => {
    const title = callTitle({ mode: "search", query: `${"x".repeat(100)}\nnext`, items });
    expect(title).toBe(`memory [mode=search, query="${"x".repeat(57)}...", limit=2]`);
  });
});

describe("unfoldLines", () => {
  it("lists mode, query, limit and each memory for a search", () => {
    const summary = buildRecallSummary(SECTION, "search", "how did we handle om-pi-todo")!;
    expect(unfoldLines(summary)).toEqual([
      "mode: search",
      "query: how did we handle om-pi-todo",
      "limit: 3",
      "1. 67% id=mem_aaa User asked to add a claude-adapter.",
      "2. 62% id=mem_bbb OMMS global embeddings use llama.cpp through the Llama app.",
      "3. 41% A memory without an id.",
    ]);
  });

  it("leaves out the query line for a recent recall", () => {
    expect(unfoldLines({ mode: "recent", query: null, items })).toEqual([
      "mode: recent",
      "limit: 2",
      "1. 80% a",
      "2. 70% b",
    ]);
  });

  it("cuts the query to 300 characters", () => {
    const lines = unfoldLines({ mode: "search", query: "q".repeat(500), items });
    expect(lines[1]).toBe(`query: ${"q".repeat(297)}...`);
    expect(lines[1]).toHaveLength("query: ".length + 300);
  });
});
