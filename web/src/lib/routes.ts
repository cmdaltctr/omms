export const ROUTES = {
  home: "/",
  project: "/project-memories",
  profile: "/user-profile",
  settings: "/settings",
  memory: "/memory",
} as const;

export type AppView = "project" | "profile" | "settings" | "memory";

export function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path.startsWith("/") ? path : `/${path}`;
}

export function viewFromPath(pathname: string): AppView {
  const path = normalizePath(pathname);
  if (path === ROUTES.memory) return "memory";
  if (path === ROUTES.settings) return "settings";
  return path === ROUTES.profile ? "profile" : "project";
}

export function pathForView(view: AppView): string {
  if (view === "memory") return ROUTES.memory;
  if (view === "settings") return ROUTES.settings;
  return view === "profile" ? ROUTES.profile : ROUTES.project;
}

export function isAppPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return (
    path === ROUTES.home ||
    path === ROUTES.project ||
    path === ROUTES.profile ||
    path === ROUTES.settings ||
    path === ROUTES.memory
  );
}

/** Canonical app path — `/` redirects to project memories. */
export function resolveAppPath(pathname: string): string {
  const path = normalizePath(pathname);
  if (path === ROUTES.home) return ROUTES.project;
  if (isAppPath(path)) return path;
  return ROUTES.project;
}
