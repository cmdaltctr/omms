export const ROUTES = {
  home: "/",
  project: "/project-memories",
  profile: "/user-profile",
  settings: "/settings",
  memory: "/memory",
  chat: "/chat",
  skills: "/skills",
} as const;

export type AppView = "project" | "profile" | "settings" | "memory" | "chat" | "skills";

/** The Memory page's views after the overview, in sidebar order. */
export const MEMORY_VIEWS = ["pi", "opencode", "claude-code", "shared"] as const;
export type MemoryViewId = (typeof MEMORY_VIEWS)[number];

export function memoryPath(view: MemoryViewId): string {
  return `${ROUTES.memory}/${view}`;
}

const isMemoryPath = (path: string) =>
  path === ROUTES.memory || path.startsWith(`${ROUTES.memory}/`);

/** The Memory view named by a path, or null for the overview and for unknown names. */
export function memoryViewFromPath(pathname: string): MemoryViewId | null {
  const name = /^\/memory\/([^/]+)$/.exec(normalizePath(pathname))?.[1];
  return (MEMORY_VIEWS as readonly string[]).includes(name ?? "") ? (name as MemoryViewId) : null;
}

export function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path.startsWith("/") ? path : `/${path}`;
}

export function viewFromPath(pathname: string): AppView {
  const path = normalizePath(pathname);
  if (isMemoryPath(path)) return "memory";
  if (path === ROUTES.settings) return "settings";
  if (path === ROUTES.chat) return "chat";
  if (path === ROUTES.skills) return "skills";
  return path === ROUTES.profile ? "profile" : "project";
}

export function pathForView(view: AppView): string {
  if (view === "memory") return ROUTES.memory;
  if (view === "settings") return ROUTES.settings;
  if (view === "chat") return ROUTES.chat;
  if (view === "skills") return ROUTES.skills;
  return view === "profile" ? ROUTES.profile : ROUTES.project;
}

export function isAppPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return (
    path === ROUTES.home ||
    path === ROUTES.project ||
    path === ROUTES.profile ||
    path === ROUTES.settings ||
    isMemoryPath(path) ||
    path === ROUTES.chat ||
    path === ROUTES.skills
  );
}

/** Canonical app path — `/` redirects to project memories. */
export function resolveAppPath(pathname: string): string {
  const path = normalizePath(pathname);
  if (path === ROUTES.home) return ROUTES.project;
  // An unknown Memory sub-path opens the overview.
  if (isMemoryPath(path)) return memoryViewFromPath(path) ? path : ROUTES.memory;
  if (isAppPath(path)) return path;
  return ROUTES.project;
}
