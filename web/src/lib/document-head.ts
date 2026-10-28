// Keeps <html lang> and the theme-color meta in step with the chosen language and theme.
// Pure on purpose: callers pass the document, so tests need no browser.

type Lang = "en" | "zh" | "ar";
type Theme = "dark" | "light";

// Match --background in app.css so Safari's tab bar matches the page.
const THEME_COLORS: Record<Theme, string> = { dark: "#120f0e", light: "#fdfcfa" };

const HTML_LANGS: Record<Lang, string> = { en: "en-GB", zh: "zh-Hans", ar: "ar" };

export function htmlLangFor(lang: Lang): string {
  return HTML_LANGS[lang];
}

export function themeColorFor(theme: Theme): string {
  return THEME_COLORS[theme];
}

export function applyThemeColor(doc: Document, theme: Theme): void {
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColorFor(theme));
}
