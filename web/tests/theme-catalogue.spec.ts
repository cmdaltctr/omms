import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  THEMES,
  findTheme,
  themeStylesheet,
  themeTokens,
  themesOf,
} from "../src/lib/themes/catalogue.ts";

const css = readFileSync(join(import.meta.dir, "../src/app.css"), "utf8");
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const colourTokens = [...rootBlock.matchAll(/^\s*(--[a-z0-9-]+):/gm)]
  .map((match) => match[1])
  // Not colours a theme owns: the corner radius, and the OMMS brand green.
  .filter((name) => name !== "--radius" && name !== "--brand-label");

it("offers the OMMS pair first and the OpenChamber themes in both variants", () => {
  expect(themesOf("light")[0].id).toBe(DEFAULT_LIGHT_THEME);
  expect(themesOf("dark")[0].id).toBe(DEFAULT_DARK_THEME);
  expect(themesOf("light").length).toBe(themesOf("dark").length);
  expect(themesOf("dark").length).toBeGreaterThan(20);
  expect(new Set(THEMES.map((theme) => `${theme.id}`)).size).toBe(THEMES.length);
});

it("adds no rule for the default pair, so the app looks as it does today", () => {
  expect(themeStylesheet(DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME)).toBe("");
});

it("falls back to the OMMS theme for an unknown id", () => {
  expect(findTheme("no-such-theme", "dark").id).toBe(DEFAULT_DARK_THEME);
  expect(themeStylesheet("no-such-theme", "also-missing")).toBe("");
});

it("sets every colour token of app.css for every theme", () => {
  expect(colourTokens.length).toBeGreaterThan(30);
  for (const theme of THEMES) {
    const tokens = themeTokens(theme.colours, theme.variant);
    expect({ id: theme.id, missing: colourTokens.filter((name) => !(name in tokens)) }).toEqual({
      id: theme.id,
      missing: [],
    });
  }
});

it("scopes a light theme to light mode and a dark theme to dark mode", () => {
  const sheet = themeStylesheet("github-light", "catppuccin-dark");
  expect(sheet).toContain(":root:not(.dark) {");
  expect(sheet).toContain(":root.dark {");
  expect(sheet).toContain("--background: #1e1e2e;");
  // The focus ring follows the accent, not a mostly transparent focus colour.
  expect(sheet).toContain("--ring: #cba6f7;");
});
