import { afterEach, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { keywordHue } from "../src/lib/components/explorer/KeywordBadge.tsx";
import type { MemoryItem } from "../src/lib/types.ts";

// DOMPurify needs a browser DOM. These SSR checks cover badges, not sanitisation.
mock.module("dompurify", () => ({ default: { sanitize: (html: string) => html } }));
const { MemoryCard } = await import("../src/lib/components/explorer/MemoryCard.tsx");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function memory(memoryType: string): MemoryItem {
  return {
    id: "synthetic-memory",
    type: "memory",
    content: "Synthetic badge note",
    memoryType,
    containerTag: "omms_preview",
    createdAt: "2026-10-03T12:00:00.000Z",
    tags: ["directory-maps", "ui-ux"],
  };
}
const prompt: MemoryItem = {
  ...memory(""),
  id: "synthetic-prompt",
  type: "prompt",
  tags: undefined,
};
function rendered(type: string, pair = false) {
  const item = memory(type);
  return renderToStaticMarkup(
    pair ? (
      <MemoryCard variant="pair" memory={item} prompt={prompt} />
    ) : (
      <MemoryCard variant="memory" item={item} />
    )
  );
}
function typePill(html: string) {
  const pill = html.match(/<span[^>]*data-memory-type="[^"]+"[^>]*>[\s\S]*?<\/span>/)?.[0];
  expect(pill).toBeDefined();
  return pill!;
}
for (const pair of [false, true]) {
  for (const type of ["analysis", "bug-fix", "unknown-stored-type"]) {
    it(`renders ${type} as one stable unfilled coloured outline on ${pair ? "paired" : "memory"} cards`, () => {
      const first = typePill(rendered(type, pair));
      expect(first).toContain(`--memory-type-hue:${keywordHue(type)}`);
      expect(first).toContain("bg-transparent");
      expect(first).toContain("border-current");
      expect(first).toContain("[color:oklch(0.42_0.13_var(--memory-type-hue))]");
      expect(first).toContain("dark:[color:oklch(0.8_0.13_var(--memory-type-hue))]");
      expect(first).not.toContain("background-color:");
      expect(rendered(type, pair).match(/data-memory-type=/g)).toHaveLength(1);
      expect(typePill(rendered(type, pair))).toBe(first);
      expect(first).toContain(`>${type}</span>`);
      const tags = [
        ...rendered(type, pair).matchAll(
          /<button[^>]*aria-pressed="false"[^>]*>([^<]+)<\/button>/g
        ),
      ].map((match) => match[1]);
      expect(tags).toEqual(["directory-maps", "ui-ux"]);
    });
  }
}
for (const variant of ["memory", "prompt"] as const) {
  it(`colours existing linked ${variant} pills green without changing relationships`, () => {
    const item = {
      ...memory("analysis"),
      type: variant,
      linkedMemoryId: variant === "prompt" ? "related-memory" : undefined,
      linkedPromptId: variant === "memory" ? "related-prompt" : undefined,
    } as MemoryItem;
    const before = structuredClone(item);
    const html = renderToStaticMarkup(<MemoryCard variant={variant} item={item} />);
    const linked = [...html.matchAll(/<span[^>]*data-slot="badge"[^>]*>[\s\S]*?<\/span>/g)]
      .map((match) => match[0])
      .find((pill) => pill.includes("LINKED"));
    expect(linked).toBeDefined();
    expect(linked).toContain("text-status-success");
    expect(linked).toContain("border-status-success");
    expect(linked).toContain("bg-transparent");
    expect(linked).toContain("lucide-link");
    expect(item).toEqual(before);
    const unlinked = { ...item, linkedMemoryId: undefined, linkedPromptId: undefined };
    expect(renderToStaticMarkup(<MemoryCard variant={variant} item={unlinked} />)).not.toContain(
      "LINKED"
    );
  });
}

it("does not create labels, tags or storage writes during repeated renders", () => {
  const item = memory("analysis");
  const before = structuredClone(item);
  const fetch = mock(() => {
    throw new Error("Rendering must not write");
  });
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  const onKeywordClick = mock(() => {});
  for (let i = 0; i < 3; i++)
    renderToStaticMarkup(
      <MemoryCard variant="memory" item={item} onKeywordClick={onKeywordClick} />
    );
  expect(item).toEqual(before);
  expect(fetch).not.toHaveBeenCalled();
  expect(onKeywordClick).not.toHaveBeenCalled();
});
