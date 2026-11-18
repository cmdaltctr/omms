import { expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import type { MemoryItem } from "../src/lib/types.ts";

const i18n = await import("../src/lib/i18n/index.ts");
mock.module("../src/lib/i18n/index.ts", () => ({
  ...i18n,
  useI18n: () => ({ language: "en", t: (key: string) => key }),
}));
// DOMPurify needs a DOM; the layout test does not need the rendered Markdown.
mock.module("../src/lib/markdown.ts", () => ({ renderMarkdown: (text: string) => text }));
const { CollapsibleContent } =
  await import("../src/lib/components/explorer/CollapsibleContent.tsx");
const { MemoryCard } = await import("../src/lib/components/explorer/MemoryCard.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}

const item = (over: Partial<MemoryItem> = {}): MemoryItem =>
  ({
    id: "mem_1",
    type: "memory",
    content: "Some memory text",
    createdAt: "2026-11-18T10:00:00.000Z",
    ...over,
  }) as MemoryItem;

const cards: [string, ReactNode][] = [
  ["memory", MemoryCard({ variant: "memory", item: item() })],
  ["prompt", MemoryCard({ variant: "prompt", item: item({ id: "prompt_1", type: "prompt" }) })],
  [
    "pair",
    MemoryCard({
      variant: "pair",
      memory: item(),
      prompt: item({ id: "prompt_1", type: "prompt", content: "A prompt" }),
    }),
  ],
];

for (const [name, card] of cards) {
  it(`a ${name} card folds as one block at a fixed height`, () => {
    const frames = find(card, (node) => node.type === CollapsibleContent);
    // One frame for the whole card, so every card in the grid has the same collapsed height.
    expect(frames.length).toBe(1);
    const height = String(frames[0].props.collapsedClassName);
    expect(height).toMatch(/(^| )h-\[/);
    expect(height).toMatch(/md:h-\[/);
    expect(height).toMatch(/lg:h-\[/);
  });
}
