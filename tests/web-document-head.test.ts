import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyThemeColor, htmlLangFor, themeColorFor } from "../web/src/lib/document-head.js";

const css = readFileSync(join(import.meta.dir, "..", "web", "src", "app.css"), "utf8");

it("gives each UI language a full HTML language code", () => {
  expect(htmlLangFor("en")).toBe("en-GB");
  expect(htmlLangFor("zh")).toBe("zh-Hans");
  expect(htmlLangFor("ar")).toBe("ar");
});

it("uses the page background of each theme as the browser theme colour", () => {
  const light = css.match(/:root\s*\{[^}]*--background:\s*(#[0-9a-f]{6})/)?.[1];
  const dark = css.match(/\.dark\s*\{[^}]*--background:\s*(#[0-9a-f]{6})/)?.[1];
  expect(themeColorFor("light")).toBe(light!);
  expect(themeColorFor("dark")).toBe(dark!);
});

it("rewrites the theme-color meta when the theme changes", () => {
  let content = "#120f0e";
  const meta = { setAttribute: (_: string, value: string) => (content = value) };
  const doc = { querySelector: () => meta } as unknown as Document;
  applyThemeColor(doc, "light");
  expect(content).toBe("#fdfcfa");
  applyThemeColor(doc, "dark");
  expect(content).toBe("#120f0e");
});
