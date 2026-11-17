import { beforeEach, expect, it, mock } from "bun:test";
import { allText, byType, installReact, render, resetRender, type Node } from "./space-kit.tsx";

installReact();
const navigated: string[] = [];
mock.module("../src/lib/router.ts", () => ({ navigate: (to: string) => navigated.push(to) }));
const revealed: Array<[string, unknown]> = [];
mock.module("../src/lib/settings-navigation.ts", () => ({
  revealPageAnchor: (hash: string, options?: unknown) => revealed.push([hash, options]),
}));

const { SettingsSearch } = await import("../src/lib/components/settings/SettingsSearch.tsx");
const { searchSettings } = await import("../src/lib/settings-search.ts");
const { SETTINGS_CATALOGUE } = await import("../src/lib/settings-catalogue.ts");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { translateCatalogue } = await import("../src/lib/i18n/settings-catalogue.ts");

const own = [SettingsSearch];
const page = <SettingsSearch />;

/** Type into the box, then render again, as React does after a state change. */
function type(value: string): Node[] {
  byType(render(page, own), Input)[0]!.props.onChange({ target: { value } });
  return render(page, own);
}
const results = (tree: Node[]) =>
  tree.filter((node) => node.type === Button && node.props["data-result"] !== undefined);

beforeEach(() => {
  resetRender();
  navigated.length = 0;
  revealed.length = 0;
  setLanguage("en");
});

it("finds a setting by its key, name or description", () => {
  const keys = (query: string) => searchSettings(query, SETTINGS_CATALOGUE).map((e) => e.key);
  expect(keys("reranker")).toContain("rerankerApiUrl");
  expect(keys("rerankerTimeoutMs")).toEqual(["rerankerTimeoutMs"]);
  expect(keys("delete old")).toContain("autoDeleteOldMemories");
  expect(keys("nothing like this setting")).toEqual([]);
  expect(keys("   ")).toEqual([]);
});

it("lists the reranker settings on the Memory page", () => {
  const tree = type("reranker");
  const rows = results(tree);
  expect(rows.length).toBeGreaterThan(0);
  expect(allText(tree)).toContain("Memory page");
  expect(allText(tree)).toContain("Reranker server address");
});

it("opens the page and the card when a result is chosen", () => {
  const rows = results(type("reranker server address"));
  rows[0]!.props.onClick();
  expect(navigated).toEqual(["/memory/shared#shared-reranker"]);
  // Focus leaves the search box for the card, for keyboard and screen reader users.
  expect(revealed).toEqual([["#shared-reranker", { focus: true }]]);
});

it("points at the config file when nothing matches", () => {
  const tree = type("zzzz");
  expect(results(tree)).toHaveLength(0);
  const words = allText(tree);
  expect(words).toContain("config file");
  expect(words).toContain("Configuration guide");
});

it("shows no list and no note before anything is typed", () => {
  const tree = render(page, own);
  expect(results(tree)).toHaveLength(0);
  expect(allText(tree)).not.toContain("Configuration guide");
});

it("gives the box an accessible name", () => {
  const box = byType(render(page, own), Input)[0]!;
  expect(box.props["aria-label"]).toBe("Search settings");
});

it("finds a setting by its Chinese name", () => {
  setLanguage("zh");
  const found = searchSettings("重排", SETTINGS_CATALOGUE, "zh").map((e) => e.key);
  expect(found).toContain("rerankerEnabled");
});

it("matches Arabic typed without diacritics", () => {
  const strip = (text: string) => text.replace(/[ً-ْٰـ]/g, "");
  const missed = SETTINGS_CATALOGUE.filter((entry) => {
    const arabic = translateCatalogue(entry.name, "ar");
    const typed = strip(arabic);
    return !searchSettings(typed, SETTINGS_CATALOGUE, "ar").some((e) => e.key === entry.key);
  }).map((entry) => entry.key);
  expect(missed).toEqual([]);
});
