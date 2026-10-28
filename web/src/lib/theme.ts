import { useSyncExternalStore } from "react";
import { applyThemeColor } from "./document-head";
import { readPreference, writePreference } from "./preferences";
import { parseSavedTheme, resolveTheme, type Theme } from "./theme-choice";

export type { Theme };

const STORAGE_KEY = "omms-theme";
const LEGACY_STORAGE_KEY = "opencode-mem-theme";
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

let currentTheme: Theme = readTheme();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

// Only a click on the toggle saves the theme; otherwise the system setting stays in charge.
function applyTheme(theme: Theme, save = false) {
  currentTheme = theme;
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", theme === "dark");
    applyThemeColor(document, theme);
    if (save) writePreference(STORAGE_KEY, theme);
  }
  emit();
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

// Apply on module load so first paint matches the saved or system theme.
if (typeof document !== "undefined") {
  applyTheme(currentTheme);
  // Follow a system change while the user has not picked a theme.
  window.matchMedia?.(SYSTEM_DARK).addEventListener?.("change", () => {
    if (savedTheme() === null) applyTheme(readTheme());
  });
}
