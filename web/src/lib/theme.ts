import { useSyncExternalStore } from "react";
import { applyThemeColor } from "./document-head";
import { readPreference, removePreference, writePreference } from "./preferences";
import { parseSavedTheme, resolveTheme, type Theme } from "./theme-choice";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  findTheme,
  themeStylesheet,
} from "./themes/catalogue";

export type { Theme };

/** System follows the operating system; Light and Dark stay put. */
export type ThemeMode = "system" | Theme;
export type ThemeChoice = { mode: ThemeMode; light: string; dark: string };

const STORAGE_KEY = "omms-theme";
const LEGACY_STORAGE_KEY = "opencode-mem-theme";
const LIGHT_KEY = "omms-theme-light";
const DARK_KEY = "omms-theme-dark";
const STYLE_ID = "omms-theme";
const SYSTEM_DARK = "(prefers-color-scheme: dark)";

function savedTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  return parseSavedTheme(readPreference(STORAGE_KEY, LEGACY_STORAGE_KEY));
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia(SYSTEM_DARK).matches;
}

function readTheme(): Theme {
  return resolveTheme(savedTheme(), systemPrefersDark());
}

function readChoice(): ThemeChoice {
  const stored = (key: string, fallback: string) =>
    typeof window === "undefined" ? fallback : (readPreference(key, key) ?? fallback);
  return {
    mode: savedTheme() ?? "system",
    light: findTheme(stored(LIGHT_KEY, DEFAULT_LIGHT_THEME), "light").id,
    dark: findTheme(stored(DARK_KEY, DEFAULT_DARK_THEME), "dark").id,
  };
}

let currentTheme: Theme = readTheme();
let currentChoice: ThemeChoice = readChoice();
// A pick this session still wins when storage is blocked and the save failed.
let pickedThisSession = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

// Only a click on the toggle saves the theme; otherwise the system setting stays in charge.
function applyTheme(theme: Theme, save = false) {
  currentTheme = theme;
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", theme === "dark");
    applyPalette(document, theme);
    if (save) {
      pickedThisSession = true;
      writePreference(STORAGE_KEY, theme);
      currentChoice = { ...currentChoice, mode: theme };
    }
  }
  emit();
}

/** Writes the chosen light and dark themes as one style element, and the tab colour. */
function applyPalette(doc: Document, theme: Theme) {
  const css = themeStylesheet(currentChoice.light, currentChoice.dark);
  let style = doc.getElementById(STYLE_ID);
  if (css === "") style?.remove();
  else {
    if (!style) {
      style = doc.createElement("style");
      style.id = STYLE_ID;
      doc.head.append(style);
    }
    style.textContent = css;
  }
  const chosen =
    theme === "dark"
      ? findTheme(currentChoice.dark, "dark")
      : findTheme(currentChoice.light, "light");
  applyThemeColor(doc, theme, chosen.colours.canvas);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return currentTheme;
}

function getServerSnapshot(): Theme {
  return "dark";
}

export function getTheme(): Theme {
  return currentTheme;
}

export function setTheme(theme: Theme) {
  applyTheme(theme, true);
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function initTheme(): void {
  applyTheme(readTheme());
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const getChoice = () => currentChoice;

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, getChoice, getChoice);
}

/** System forgets the saved mode, so the operating system decides again. */
export function setThemeMode(mode: ThemeMode) {
  if (mode !== "system") return setTheme(mode);
  pickedThisSession = false;
  removePreference(STORAGE_KEY);
  currentChoice = { ...currentChoice, mode: "system" };
  applyTheme(readTheme());
}

export function setPalette(variant: Theme, id: string) {
  const next = findTheme(id, variant).id;
  writePreference(variant === "light" ? LIGHT_KEY : DARK_KEY, next);
  currentChoice = { ...currentChoice, [variant]: next };
  applyTheme(currentTheme);
}

// Apply on module load so first paint matches the saved or system theme.
if (typeof document !== "undefined") {
  applyTheme(currentTheme);
  // Follow a system change while the user has not picked a theme.
  window.matchMedia?.(SYSTEM_DARK).addEventListener?.("change", () => {
    if (!pickedThisSession && savedTheme() === null) applyTheme(readTheme());
  });
}
