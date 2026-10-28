import { expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const webDir = join(import.meta.dir, "..", "web");
const html = readFileSync(join(webDir, "index.html"), "utf8");

it("names the product OMMS in the browser tab", () => {
  expect(html).toContain("<title>OMMS Memory Explorer</title>");
});

it("gives browsers the page metadata they read before the app loads", () => {
  expect(html).toContain('<html lang="en-GB"');
  expect(html).toMatch(/<meta name="color-scheme" content="[^"]+"/);
  expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}"/);
  expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]+"/);
  expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
});

it("links an Apple touch icon that exists", () => {
  expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"');
  expect(existsSync(join(webDir, "public", "apple-touch-icon.png"))).toBe(true);
});
