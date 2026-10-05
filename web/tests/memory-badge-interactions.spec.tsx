import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import type { MemoryItem } from "../src/lib/types.ts";

let id = 0;
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useId: () => `tooltip-${id++}`,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => {}],
}));
const { MemoryCard } = await import("../src/lib/components/explorer/MemoryCard.tsx");
const { KeywordBadge, keywordHue } =
  await import("../src/lib/components/explorer/KeywordBadge.tsx");
const { setLanguage, t } = await import("../src/lib/i18n/index.ts");
type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!react.isValidElement(value)) return [];
  const node = value as Node;
  if (
    typeof node.type === "function" &&
    ["MemoryTypeBadge", "KeywordBadge", "Tooltip", "Badge"].includes(node.type.name)
  ) {
    return nodes((node.type as (props: Node["props"]) => ReactNode)(node.props));
  }
  return [node, ...nodes(node.props.children)];
}
const fixture: MemoryItem = {
  id: "synthetic",
  type: "memory",
  content: "",
  memoryType: "analysis",
  containerTag: "omms_preview",
  createdAt: "2026-10-03T12:00:00.000Z",
  tags: ["directory-maps"],
};
// The browser sanitiser is outside these trigger and filter checks.
mock.module("dompurify", () => ({ default: { sanitize: (html: string) => html } }));
beforeEach(() => {
  id = 0;
  setLanguage("en");
});
for (const pair of [false, true]) {
  it(`associates type and tag descriptions with real keyboard triggers in ${pair ? "paired" : "memory"} cards`, () => {
    const onKeywordClick = mock(() => {});
    const rendered = nodes(
      MemoryCard({
        variant: pair ? "pair" : "memory",
        item: fixture,
        memory: fixture,
        prompt: { ...fixture, type: "prompt" },
        activeKeyword: "directory-maps",
        onKeywordClick,
      })
    );
    const type = rendered.find((node) => node.props["data-memory-type"] === "analysis")!;
    expect(type).toBeDefined();
    expect(type.props.tabIndex).toBe(0);
    const tag = rendered.find(
      (node) => node.type === "button" && node.props.children === "directory-maps"
    )!;
    expect(tag).toBeDefined();
    expect(tag.props["aria-pressed"]).toBe(true);
    expect(tag.props.title).toBeUndefined();
    expect(tag.props["aria-label"]).toContain(t("tooltip-filter-keyword"));
    for (const [trigger, role] of [
      [type, "Memory type"],
      [tag, "Tags"],
    ] as const) {
      const description = rendered.find(
        (node) => node.props.id === trigger.props["aria-describedby"]
      );
      expect(description?.props.role).toBe("tooltip");
      expect(description?.props.children).toContain(role);
      expect(description?.props.className).toContain("group-focus-within/tooltip:opacity-100");
      expect(description?.props.className).toContain("group-hover/tooltip:opacity-100");
    }
    (tag.props.onClick as () => void)();
    expect(onKeywordClick).toHaveBeenCalledWith("directory-maps");
    expect(onKeywordClick).toHaveBeenCalledTimes(1);
  });
}
it("forwards tooltip description to the keyword button and preserves its colour output", () => {
  const node = KeywordBadge({
    keyword: " Directory-Maps ",
    "aria-describedby": "role-tip",
    "aria-label": "Filter by keyword",
  });
  expect(node.props["aria-describedby"]).toBe("role-tip");
  expect(node.props["aria-label"]).toBe("Filter by keyword");
  const hue = keywordHue("directory-maps");
  expect(node.props.style).toEqual({
    backgroundColor: `oklch(0.72 0.14 ${hue} / 0.18)`,
    borderColor: `oklch(0.72 0.14 ${hue} / 0.45)`,
    "--keyword-hue": String(hue),
    "--tw-ring-color": `oklch(0.72 0.14 ${hue} / 0.7)`,
  });
});
for (const language of ["en", "zh", "ar"] as const) {
  it(`translates badge roles into ${language} without changing stored labels`, () => {
    setLanguage(language);
    const rendered = nodes(MemoryCard({ variant: "memory", item: fixture }));
    const tooltips = rendered.filter((node) => node.props.role === "tooltip");
    expect(
      tooltips.some(
        (node) => react.Children.toArray(node.props.children)[0] === t("tooltip-memory-type")
      )
    ).toBe(true);
    expect(
      tooltips.some((node) => react.Children.toArray(node.props.children)[0] === t("tooltip-tags"))
    ).toBe(true);
    expect(t("tooltip-memory-type")).toMatch(
      language === "en"
        ? /^Memory type$/
        : language === "zh"
          ? /[\u4e00-\u9fff]/
          : /[\u0600-\u06ff]/
    );
    expect(t("tooltip-tags")).toMatch(
      language === "en" ? /^Tags$/ : language === "zh" ? /[\u4e00-\u9fff]/ : /[\u0600-\u06ff]/
    );
    expect(rendered.some((node) => node.props["data-memory-type"] === "analysis")).toBe(true);
    expect(
      rendered.some((node) => node.type === "button" && node.props.children === "directory-maps")
    ).toBe(true);
  });
}
