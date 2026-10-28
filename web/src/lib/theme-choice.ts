// Which theme to show. A theme the user picked wins; otherwise follow the system setting.
// Pure on purpose so tests need no browser.

export type Theme = "dark" | "light";

export function parseSavedTheme(stored: string | null): Theme | null {
  return stored === "light" || stored === "dark" ? stored : null;
}

export function resolveTheme(saved: Theme | null, systemPrefersDark: boolean): Theme {
  return saved ?? (systemPrefersDark ? "dark" : "light");
}
