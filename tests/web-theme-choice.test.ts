import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSavedTheme, resolveTheme } from "../web/src/lib/theme-choice.js";

const webDir = join(import.meta.dir, "..", "web");

it("follows the system setting when the user has not picked a theme", () => {
  expect(resolveTheme(null, true)).toBe("dark");
  expect(resolveTheme(null, false)).toBe("light");
});

it("keeps the theme the user picked whatever the system says", () => {
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});

it("ignores a saved value that is not a theme", () => {
  expect(parseSavedTheme(null)).toBeNull();
  expect(parseSavedTheme("system")).toBeNull();
  expect(parseSavedTheme("dark")).toBe("dark");
});

it("saves the theme only when the user picks one", () => {
  const source = readFileSync(join(webDir, "src", "lib", "theme.ts"), "utf8");
  // The mode key is written in one place; the light and dark theme ids have their own keys.
  const writes = source.match(/writePreference\(STORAGE_KEY/g) ?? [];
  expect(writes.length).toBe(1);
  expect(source).toMatch(/if \(save\) \{[^}]*writePreference\(STORAGE_KEY, theme\)/);
  expect(source).toMatch(/export function setTheme\(theme: Theme\) \{\s*applyTheme\(theme, true\)/);
});

it("picks the theme in index.html before first paint", () => {
  const html = readFileSync(join(webDir, "index.html"), "utf8");
  expect(html).toContain("prefers-color-scheme: dark");
  expect(html).toContain('localStorage.getItem("omms-theme")');
});

it("keeps a pick made this session when storage is blocked", () => {
  const source = readFileSync(join(webDir, "src", "lib", "theme.ts"), "utf8");
  expect(source).toMatch(/pickedThisSession = true;\s*writePreference/);
  expect(source).toMatch(/if \(!pickedThisSession && savedTheme\(\) === null\)/);
});

it("still follows the system in index.html when storage is blocked", () => {
  const html = readFileSync(join(webDir, "index.html"), "utf8");
  const storageRead = html.indexOf('localStorage.getItem("omms-theme")');
  const systemCheck = html.indexOf("prefers-color-scheme: dark");
  const between = html.slice(storageRead, systemCheck);
  expect(between).toContain("catch");
});
