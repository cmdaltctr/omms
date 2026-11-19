import { beforeEach, expect, it, mock } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import * as react from "react";
import { SETTINGS_SECTIONS } from "../src/lib/settings-sections.ts";
import * as sections from "../src/lib/settings-sections.ts";
import { translateSettings } from "../src/lib/i18n/settings.ts";
import * as realRouter from "../src/lib/router.ts";

let path = "/settings";
const navigated: unknown[][] = [];
mock.module("react", () => ({
  ...react,
  useEffect: () => {},
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
mock.module("../src/lib/router.ts", () => ({
  ...realRouter,
  usePath: () => path,
  navigate: (...args: unknown[]) => void navigated.push(args),
}));
mock.module("../src/hooks/useSettingsSnapshot.ts", () => ({
  useSettingsSnapshot: () => ({ snapshot: undefined }),
}));
const { SettingsView } = await import("../src/lib/components/settings/SettingsView.tsx");
const { setProfileCount } = await import("../src/lib/profile-count.ts");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}
const page = () => SettingsView();
const chips = (tree: ReactNode) => find(tree, (node) => "aria-pressed" in node.props);
const wrappers = (tree: ReactNode) =>
  find(tree, (node) => SETTINGS_SECTIONS.some((section) => section.id === node.props.id));
const pressedIds = (tree: ReactNode) =>
  chips(tree).flatMap((chip, index) =>
    chip.props["aria-pressed"] === true ? [SETTINGS_SECTIONS[index].id] : []
  );
const shownIds = (tree: ReactNode) =>
  wrappers(tree)
    .filter((wrapper) => !wrapper.props.hidden)
    .map((wrapper) => wrapper.props.id);

const PROFILES = "settings-section-profiles";
const chipTitles = (tree: ReactNode) => chips(tree).map((chip) => chip.props.children);

beforeEach(() => {
  path = "/settings";
  navigated.length = 0;
  // Two profiles show the Profiles chip, so the older specs see all 15 chips.
  setProfileCount(2);
});

it("picks the section named by the address and falls back to Memory basics", () => {
  const select = (sections as Record<string, unknown>).selectedSettingsSection as (
    path: string
  ) => string;
  expect(select("/settings")).toBe("settings-section-memory-basics");
  expect(select("/settings#settings-section-log")).toBe("settings-section-log");
  expect(select("/settings#settings-section-nope")).toBe("settings-section-memory-basics");
  expect(select("/settings#directory-maps-pi")).toBe("settings-section-memory-basics");
});

it("shows Memory basics for /settings with exactly its chip pressed", () => {
  const tree = page();
  expect(shownIds(tree)).toEqual(["settings-section-memory-basics"]);
  expect(pressedIds(tree)).toEqual(["settings-section-memory-basics"]);
});

it("shows Log for /settings#settings-section-log", () => {
  path = "/settings#settings-section-log";
  const tree = page();
  expect(shownIds(tree)).toEqual(["settings-section-log"]);
  expect(pressedIds(tree)).toEqual(["settings-section-log"]);
});

it("shows Memory basics for an unknown anchor", () => {
  path = "/settings#settings-section-unknown";
  const tree = page();
  expect(shownIds(tree)).toEqual(["settings-section-memory-basics"]);
  expect(pressedIds(tree)).toEqual(["settings-section-memory-basics"]);
});

it("keeps every card mounted and renders one chip per section, labelled with its title", () => {
  const tree = page();
  expect(wrappers(tree).map((wrapper) => wrapper.props.id)).toEqual(
    SETTINGS_SECTIONS.map((section) => section.id)
  );
  expect(chips(tree).map((chip) => chip.props.children)).toEqual(
    SETTINGS_SECTIONS.map((section) => section.title)
  );
  const group = find(tree, (node) => node.props.role === "group")[0];
  expect(group?.props["aria-label"]).toBe("Sections");
});

it("a chip pushes its anchor without the reveal", () => {
  const log = chips(page())[SETTINGS_SECTIONS.length - 1];
  (log.props.onClick as () => void)();
  expect(navigated).toEqual([["/settings#settings-section-log", false, { reveal: false }]]);
});

it("translates the Sections label into Chinese and Arabic", () => {
  expect(translateSettings("Sections", "zh")).not.toBe("Sections");
  expect(translateSettings("Sections", "ar")).not.toBe("Sections");
});

it("hides the Profiles chip with one profile and shows it with two", () => {
  setProfileCount(1);
  expect(chipTitles(page())).toEqual(
    SETTINGS_SECTIONS.filter((section) => section.id !== PROFILES).map((section) => section.title)
  );
  setProfileCount(2);
  expect(chipTitles(page())).toContain("Profiles");
});

it("hides the Profiles chip until the profile count is known", () => {
  setProfileCount(undefined);
  expect(chipTitles(page())).not.toContain("Profiles");
});

it("falls back to Memory basics when #settings-section-profiles is opened with one profile", () => {
  setProfileCount(1);
  path = `/settings#${PROFILES}`;
  const tree = page();
  expect(shownIds(tree)).toEqual(["settings-section-memory-basics"]);
  expect(chips(tree).filter((chip) => chip.props["aria-pressed"] === true)).toHaveLength(1);
  expect(chips(tree)[0]!.props["aria-pressed"]).toBe(true);
});

it("shows the Profiles card for #settings-section-profiles with two profiles", () => {
  path = `/settings#${PROFILES}`;
  expect(shownIds(page())).toEqual([PROFILES]);
});
