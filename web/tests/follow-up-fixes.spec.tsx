import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MemoryItem } from "../src/lib/types.ts";
import { PageToc } from "../src/lib/components/PageToc.tsx";
import { MemoryList } from "../src/lib/components/explorer/MemoryList.tsx";
import { PagedFooter } from "../src/lib/components/paged-list/PagedFooter.tsx";
import { pageWindow } from "../src/lib/components/paged-list/paging.ts";
import { setLanguage, t } from "../src/lib/i18n/index.ts";
import { translateSettings } from "../src/lib/i18n/settings.ts";
import { settingsCatalogueText } from "../src/lib/i18n/settings-catalogue.ts";
import { skillText } from "../src/lib/i18n/skills.ts";
import { shouldOpenTagMigration } from "../src/lib/tag-migration-prompt.ts";

// DOMPurify needs a browser DOM. These SSR checks cover structure, not sanitisation.
mock.module("dompurify", () => ({ default: { sanitize: (html: string) => html } }));
const { MemoryCard } = await import("../src/lib/components/explorer/MemoryCard.tsx");

const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
beforeEach(() => {
  store.clear();
  g.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  setLanguage("en");
});
afterEach(() => {
  delete g.window;
  delete g.localStorage;
});

/** A browser whose `(max-width: ...)` query matches when the screen is narrow. */
function screenIs(width: "narrow" | "wide") {
  g.window = { matchMedia: () => ({ matches: width === "narrow" }) };
}

const sections = [{ id: "a", title: "Alpha" }];
const toc = () => renderToStaticMarkup(<PageToc storageKey="test-toc-open" sections={sections} />);

it("starts the contents list closed at phone width and open on a wide screen", () => {
  screenIs("narrow");
  expect(toc()).not.toContain("<nav");
  screenIs("wide");
  expect(toc()).toContain("<nav");
});

it("keeps a saved choice on a narrow screen", () => {
  screenIs("narrow");
  store.set("test-toc-open", "1");
  expect(toc()).toContain("<nav");
});

const base: MemoryItem = {
  id: "m1",
  type: "memory",
  content: "A memory.",
  memoryType: "analysis",
  containerTag: "omms_preview",
  createdAt: "2026-10-03T12:00:00.000Z",
};
const prompt: MemoryItem = { ...base, id: "p1", type: "prompt" };

const editLabel = (html: string) =>
  html
    .split("<button")
    .find((chunk) => chunk.includes("lucide-pen-line"))
    ?.match(/aria-label="([^"]*)"/)?.[1];

it("labels the edit button on every card variant, with a translation in each language", () => {
  const variants = [
    renderToStaticMarkup(<MemoryCard variant="pair" memory={base} prompt={prompt} />),
    renderToStaticMarkup(<MemoryCard variant="memory" item={base} />),
  ];
  // Server rendering always uses English; the other languages come from the same key.
  for (const html of variants) expect(editLabel(html)).toBe("Edit");
  expect(t("btn-edit", {}, "zh")).toBe("编辑");
  expect(t("btn-edit", {}, "ar")).toBe("تعديل");
});

const noop = () => {};
const listProps = {
  memories: [],
  selectedIds: new Set<string>(),
  currentPage: 1,
  onSelect: noop,
  onPageChange: noop,
  onPin: noop,
  onUnpin: noop,
  onEdit: noop,
  onDeleteMemory: noop,
  onDeletePrompt: noop,
  totalItems: 0,
  isSearching: true,
};

it("shows no pager under an empty memory list", () => {
  const html = renderToStaticMarkup(<MemoryList {...listProps} totalPages={0} />);
  expect(html).toContain("No memories found");
  expect(html).not.toContain("Page 1 of 0");
  expect(html).not.toMatch(/Page \d+ of/);
});

it("still shows the pager when there are memories", () => {
  const html = renderToStaticMarkup(
    <MemoryList {...listProps} memories={[base]} totalItems={1} totalPages={2} />
  );
  expect(html).toContain("Page 1 of 2");
});

it("renders no shared footer for an empty list", () => {
  const view = { ...pageWindow(1, 5, 0), setPage: () => {} };
  expect(renderToStaticMarkup(<PagedFooter view={view} />)).toBe("");
});

it("opens the tagging dialog for a legacy store, not for one new untagged memory", () => {
  // Every memory untagged: the real migration case.
  expect(shouldOpenTagMigration(40, 40)).toBe(true);
  // One untagged memory in a store of 2,236.
  expect(shouldOpenTagMigration(1, 2236)).toBe(false);
  expect(shouldOpenTagMigration(0, 0)).toBe(false);
});

it("uses one Arabic word for Cancel in the Skills and Settings tables", () => {
  const skills = (skillText as unknown as Record<string, readonly [string, string]>).Cancel[1];
  expect(skills).toBe("إلغاء");
  expect(translateSettings("Cancel", "ar")).toBe(skills);
  expect(settingsCatalogueText.Cancel[1]).toBe(skills);
});
