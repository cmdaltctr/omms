import { useSyncExternalStore } from "react";
import { legacyMemoryAnchor } from "./memory-sections";
import { revealPageAnchor } from "./settings-navigation";
import {
  normalizePath,
  pathForView,
  resolveAppPath,
  ROUTES,
  type AppView,
  viewFromPath,
} from "./routes";

function destination(path: string, hash = ""): string {
  const legacy = legacyMemoryAnchor(normalizePath(path), hash);
  return legacy ? `${ROUTES.memory}${legacy}` : `${resolveAppPath(path)}${hash}`;
}

let currentPath =
  typeof window !== "undefined"
    ? destination(window.location.pathname, window.location.hash)
    : ROUTES.project;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setPath(next: string) {
  if (currentPath === next) return;
  currentPath = next;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return currentPath;
}

function getServerSnapshot() {
  return ROUTES.project;
}

export function navigate(to: string, replace = false) {
  const [path, hash = ""] = to.split(/(?=#)/);
  const next = destination(path, hash);
  const legacy = legacyMemoryAnchor(normalizePath(path), hash);
  if (`${normalizePath(window.location.pathname)}${window.location.hash}` !== next) {
    if (replace || legacy) window.history.replaceState({}, "", next);
    else window.history.pushState({}, "", next);
  }
  setPath(next);
  if (hash || legacy) revealPageAnchor(legacy ?? hash);
}

export function navigateView(view: AppView, replace = false) {
  navigate(pathForView(view), replace);
}

export function currentView(): AppView {
  return viewFromPath(destination(window.location.pathname, window.location.hash).split("#")[0]);
}

/** Sync store with history; `/` and unknown paths resolve to project memories. */
export function initRouter(): () => void {
  const sync = () => {
    const current = `${normalizePath(window.location.pathname)}${window.location.hash}`;
    const resolved = destination(window.location.pathname, window.location.hash);
    if (current !== resolved) window.history.replaceState({}, "", resolved);
    setPath(resolved);
    if (window.location.hash) revealPageAnchor(window.location.hash);
  };

  sync();
  window.addEventListener("popstate", sync);
  return () => window.removeEventListener("popstate", sync);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useAppView(): AppView {
  return viewFromPath(usePath().split("#")[0]);
}

export { ROUTES, pathForView, viewFromPath };
export type { AppView };
