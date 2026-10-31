import type { ComponentProps, ComponentType, MouseEvent, ReactElement } from "react";
import { Folder, MessageSquare, Sparkles, User } from "lucide-react";
import { ProfileTree } from "./ProfileTree";
import { SidebarNavLink } from "./SidebarNavLink";
import { ROUTES, type AppView } from "$lib/router";

type NavIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** The sidebar's main links in order. Memory and Settings follow, each with its own tree. */
export const MAIN_NAV = [
  { view: "project", href: ROUTES.project, icon: Folder },
  { view: "chat", href: ROUTES.chat, icon: MessageSquare },
  { view: "profile", href: ROUTES.profile, icon: User },
  { view: "skills", href: ROUTES.skills, icon: Sparkles },
] as const satisfies readonly { view: AppView; href: string; icon: NavIcon }[];

export type MainNavLabels = Record<(typeof MAIN_NAV)[number]["view"], string>;

type Options = {
  currentView: AppView;
  labels: MainNavLabels;
  collapsed: boolean;
  navClass: (active: boolean) => string;
  onNavigate: (event: MouseEvent, to: string) => void;
  /** The User profile link carries a collapsible tree of its sections. */
  profileTree: Omit<ComponentProps<typeof ProfileTree>, "link" | "label">;
};

/**
 * The main links as elements. A plain function, not a component, so the
 * sidebar's own render still holds every link.
 */
export function mainNavEntries({
  currentView,
  labels,
  collapsed,
  navClass,
  onNavigate,
  profileTree,
}: Options): ReactElement[] {
  return MAIN_NAV.map(({ view, href, icon }) => {
    const label = labels[view];
    const entry = (
      <SidebarNavLink
        key={view}
        {...{ href, label, icon, collapsed, onNavigate }}
        active={currentView === view}
        className={navClass(currentView === view)}
      />
    );
    return view === "profile" ? (
      <ProfileTree key={view} link={entry} label={label} {...profileTree} />
    ) : (
      entry
    );
  });
}
