import { expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MemoryItem } from "../src/lib/types.ts";

// DOMPurify needs a browser DOM. These SSR checks cover structure, not sanitisation.
mock.module("dompurify", () => ({ default: { sanitize: (html: string) => html } }));
const { MemoryCard } = await import("../src/lib/components/explorer/MemoryCard.tsx");

const base: MemoryItem = {
  id: "synthetic-memory",
  type: "memory",
  content: "Run `bun run check` first.",
  memoryType: "analysis",
  containerTag: "omms_preview",
  createdAt: "2026-10-03T12:00:00.000Z",
};

function pair(promptContent: string) {
  const prompt: MemoryItem = {
    ...base,
    id: "synthetic-prompt",
    type: "prompt",
    content: promptContent,
  };
  return renderToStaticMarkup(<MemoryCard variant="pair" memory={base} prompt={prompt} />);
}

it("puts pasted terminal output in its own code card inside the prompt card", () => {
  const html = pair('why?\n<pasted_content id="a1">\n$ bun run release:approve\n</pasted_content>');
  const promptCard = html.slice(html.indexOf("USER PROMPT"));
  expect(promptCard).toContain("Pasted content");
  expect(promptCard).toMatch(/<pre[^>]*>\$ bun run release:approve<\/pre>/);
  expect(promptCard).not.toContain("&lt;pasted_content");
});

it("renders inline backtick commands in a prompt as code", () => {
  expect(pair("what does `npm stage approve` do?")).toContain(
    '<code class="inline-code">npm stage approve</code>'
  );
});

it("draws the USER PROMPT label as plain text so it lines up with the prompt text", () => {
  const html = pair("hello");
  const label = html.match(/<span[^>]*>USER PROMPT<\/span>/)?.[0];
  expect(label).toBeDefined();
  expect(label).not.toContain('data-slot="badge"');
});

it("puts the memory output in its own bordered mini card on paired and standalone cards", () => {
  const miniCard =
    /<div class="rounded-lg border border-border bg-muted p-3"><div class="space-y-2">/;
  expect(pair("hello")).toMatch(miniCard);
  expect(renderToStaticMarkup(<MemoryCard variant="memory" item={base} />)).toMatch(miniCard);
});
