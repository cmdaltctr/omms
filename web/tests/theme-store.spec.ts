import { expect, it } from "bun:test";

// A minimal browser: storage, the root element, the theme-color meta and a style list.
const store = new Map<string, string>();
const classes = new Set<string>();
const styles = new Map<string, { id: string; textContent: string; remove: () => void }>();
let tabColour = "";
const g = globalThis as Record<string, unknown>;
g.window = { matchMedia: () => ({ matches: true, addEventListener: () => {} }) };
g.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};
g.document = {
  documentElement: {
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
    },
  },
  querySelector: () => ({ setAttribute: (_: string, value: string) => (tabColour = value) }),
  getElementById: (id: string) => styles.get(id) ?? null,
  createElement: () => {
    const element = { id: "", textContent: "", remove: () => styles.delete(element.id) };
    return element;
  },
  head: { append: (element: { id: string }) => styles.set(element.id, element as never) },
};

store.set("omms-theme", "dark");
store.set("omms-theme-dark", "gruvbox-dark");
store.set("omms-theme-light", "no-such-theme");
const theme = await import("../src/lib/theme.ts");

it("opens with the stored mode and theme, and the OMMS theme for an unknown id", () => {
  expect(theme.getTheme()).toBe("dark");
  expect(styles.get("omms-theme")?.textContent).toContain("--background: #1f1e1d;");
  expect(styles.get("omms-theme")?.textContent).not.toContain(":root:not(.dark)");
  expect(tabColour).toBe("#1f1e1d");
});

it("keeps a new dark theme and drops the rule for the default", () => {
  theme.setPalette("dark", "catppuccin-dark");
  expect(store.get("omms-theme-dark")).toBe("catppuccin-dark");
  expect(styles.get("omms-theme")?.textContent).toContain("--background: #1e1e2e;");
  theme.setPalette("dark", "omms-dark");
  expect(styles.has("omms-theme")).toBe(false);
  expect(tabColour).toBe("#120f0e");
});

it("forgets the saved mode for System and keeps it for the sidebar toggle", () => {
  theme.setThemeMode("system");
  expect(store.has("omms-theme")).toBe(false);
  // The fake system prefers dark.
  expect(classes.has("dark")).toBe(true);
  theme.toggleTheme();
  expect(store.get("omms-theme")).toBe("light");
  expect(classes.has("dark")).toBe(false);
});

it("lets System win over a theme saved under the old opencode-mem key", () => {
  store.set("opencode-mem-theme", "light");
  theme.setThemeMode("system");
  expect(store.has("omms-theme")).toBe(false);
  expect(store.has("opencode-mem-theme")).toBe(false);
  // The fake system prefers dark, so the old light pick no longer applies.
  expect(classes.has("dark")).toBe(true);
});
