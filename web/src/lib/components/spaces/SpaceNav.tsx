import type { MouseEvent } from "react";
import { Boxes } from "lucide-react";
import { SpaceChip } from "./SpaceChip";
import { SharedMark } from "$lib/components/memory/HostAvatar";
import { useSpaceTree } from "@/hooks/useSpaceTree";
import { ProfileTree, useSavedOpen } from "$lib/components/explorer/ProfileTree";
import { SidebarNavLink } from "$lib/components/explorer/SidebarNavLink";
import { useI18n } from "$lib/i18n";
import { ROUTES, type AppView } from "$lib/routes";
import { spaceCardId } from "$lib/space-chip";

const OPEN_KEY = "omms-sidebar-spaces-open";
/** The id of the last child, which opens the Archive page instead of a card. */
const ARCHIVE_ID = "space-archive";

/**
 * The first sidebar item: a Boxes icon labelled Spaces, with a tree of the spaces that are not
 * archived. A child opens that space's card on the Spaces page and never switches. The last child, Archive, opens the Archive page. A collapsed
 * desktop sidebar shows the icon only, and its hover text names the active space.
 */
export function SpaceNav({
  className,
  collapsed,
  currentView,
  hideWhenCollapsed,
  onNavigate,
}: {
  /** The shared sidebar row classes for this state. */
  className: string;
  collapsed: boolean;
  currentView: AppView;
  /** Classes that hide the toggle and the tree when the desktop sidebar is collapsed. */
  hideWhenCollapsed: string;
  onNavigate: (event: MouseEvent, to: string) => void;
}) {
  const { t } = useI18n();
  const { spaces, activeId, activeName, customStoragePath } = useSpaceTree();
  const onSpacesPage = currentView === "spaces" || currentView === "spaces-archive";
  const [open, toggle] = useSavedOpen(OPEN_KEY, onSpacesPage);
  const label = t("nav-spaces");
  const hover = activeName
    ? t(customStoragePath ? "spaces-nav-hover-custom" : "spaces-nav-hover", { name: activeName })
    : label;
  const rows = spaces
    .filter((space) => !space.archived)
    .map((space) => ({
      id: spaceCardId(space.id),
      label: space.name,
      title: space.name,
      leading: (
        <SpaceChip
          name={space.name}
          look={space.look}
          className="size-5 rounded-md text-[9px]"
          iconClassName="size-3"
        />
      ),
      trailing:
        space.id === activeId ? (
          <span
            role="img"
            aria-label={t("spaces-active-mark")}
            title={t("spaces-active-mark")}
            className="ms-auto size-2 shrink-0 rounded-full bg-status-success"
          />
        ) : null,
    }));
  // Like Shared in the Memory tree: the last child opens an overview page, with the same mark.
  const sections = [
    ...rows,
    {
      id: ARCHIVE_ID,
      label: t("nav-spaces-archive"),
      href: ROUTES.spacesArchive,
      current: currentView === "spaces-archive",
      leading: <SharedMark className="size-5 rounded-md" iconClassName="size-3" />,
    },
  ];

  return (
    <ProfileTree
      link={
        <SidebarNavLink
          href={ROUTES.spaces}
          label={label}
          icon={Boxes}
          collapsed={collapsed}
          active={onSpacesPage}
          className={className}
          title={collapsed ? hover : undefined}
          note={customStoragePath ? t("spaces-nav-custom") : undefined}
          onNavigate={onNavigate}
        />
      }
      label={label}
      sections={sections}
      open={open}
      onToggle={toggle}
      hideWhenCollapsed={hideWhenCollapsed}
      id="sidebar-spaces-tree"
      base={ROUTES.spaces}
      onSectionClick={(event, id) =>
        onNavigate(event, id === ARCHIVE_ID ? ROUTES.spacesArchive : `${ROUTES.spaces}#${id}`)
      }
    />
  );
}
