import { describe, expect, it } from "bun:test";
import { marked } from "marked";
import { linkCitations } from "../web/src/lib/chat-answer-html.ts";

const aria = (label: string) => `Open ${label}`;

describe("linkCitations", () => {
  it("turns a known marker in rendered markdown into a citation button", () => {
    const html = marked.parse("You prefer **plain English** [S1].", { async: false }) as string;
    const out = linkCitations(html, ["S1"], () => false, aria);
    expect(out).toContain("<strong>plain English</strong>");
    expect(out).toContain('<button type="button" class="cite-chip" data-cite="S1"');
    expect(out).not.toContain("[S1]");
  });

  it("leaves a marker that names no known source as text", () => {
    const out = linkCitations("<p>See [S9]</p>", ["S1"], () => false, aria);
    expect(out).toBe("<p>See [S9]</p>");
  });

  it("marks a deleted source and tells P labels from S labels", () => {
    const out = linkCitations("<p>[S1] [P2]</p>", ["S1", "P2"], (l) => l === "S1", aria);
    expect(out).toContain('class="cite-chip cite-deleted" data-cite="S1"');
    expect(out).toContain('class="cite-chip cite-profile" data-cite="P2"');
  });

  const render = (markdown: string) => {
    const html = marked.parse(markdown, { async: false }) as string;
    return linkCitations(html, ["S1"], () => false, aria);
  };

  it("leaves a marker inside a link title attribute alone", () => {
    const out = render('Read [the docs](https://example.com "see [S1]") now [S1].');
    expect(out).toContain('title="see [S1]"');
    expect(out).toContain('now <button type="button" class="cite-chip" data-cite="S1"');
    expect(out.match(/<button/g)).toHaveLength(1);
  });

  it("leaves a marker in an attribute that holds a greater-than sign alone", () => {
    const out = linkCitations('<p title="a > [S1]">x [S1]</p>', ["S1"], () => false, aria);
    expect(out).toContain('title="a > [S1]"');
    expect(out.match(/<button/g)).toHaveLength(1);
  });

  it("keeps a marker in a code span or code block as literal text", () => {
    expect(render("Type `[S1]` to cite.")).toContain("<code>[S1]</code>");
    expect(render("```\n[S1]\n```")).toContain("[S1]\n</code></pre>");
    expect(render("Type `[S1]` to cite.")).not.toContain("<button");
  });

  it("does not put a button inside a link", () => {
    const out = render("[see [S1]](https://example.com)");
    expect(out).not.toContain("<button");
    expect(out).toContain("see [S1]");
  });
});
