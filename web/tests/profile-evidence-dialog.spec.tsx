import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A server render reads the language store's server snapshot, which is always
// English. Read the client snapshot so setLanguage applies.
mock.module("react", () => ({
  ...react,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));

const { setLanguage } = await import("../src/lib/i18n/index.ts");

const { ProfileEvidenceBody } =
  await import("../src/lib/components/explorer/ProfileEvidenceDialog.tsx");

const item = {
  category: "Tooling",
  description: "Uses npm as the default package manager",
  frequency: 36,
  evidence: ["first quote", "manual-write", "<b>bold</b>", "last quote"],
};

beforeEach(() => setLanguage("en"));

function render(section: "preferences" | "patterns" | "workflows" = "preferences") {
  return renderToStaticMarkup(<ProfileEvidenceBody item={item as never} section={section} />);
}

it("lists every evidence item in stored order", () => {
  const html = render();
  const first = html.indexOf("first quote");
  const last = html.indexOf("last quote");
  expect(first).toBeGreaterThan(-1);
  expect(last).toBeGreaterThan(first);
  expect(html.match(/<li/g)?.length).toBe(4);
});

it("shows the manual write label instead of the raw marker", () => {
  const html = render();
  expect(html).toContain("Added by a manual memory save");
  expect(html).not.toContain(">manual-write<");
});

it("shows markup in evidence as text", () => {
  const html = render();
  expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  expect(html).not.toContain("<b>bold</b>");
});

it("shows the section, description and hit count", () => {
  const html = render("patterns");
  expect(html).toContain("PATTERNS");
  expect(html).toContain("Uses npm as the default package manager");
  expect(html).toContain("Profile analysis matched this item 36 times.");
});

it("uses the interface language for its labels", () => {
  setLanguage("zh");
  const html = render();
  expect(html).toContain("通过手动保存记忆添加");
  expect(html).toContain("画像分析匹配此项 36 次。");
});

it("lays the list out right to left in Arabic", () => {
  setLanguage("ar");
  const html = render();
  expect(html).toContain('dir="rtl"');
  expect(html).toContain("أُضيف عبر حفظ يدوي للذاكرة");
});
