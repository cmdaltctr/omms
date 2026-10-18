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
});
