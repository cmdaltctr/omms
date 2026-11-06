import type { ComponentType, MouseEvent } from "react";
import { cn } from "$lib/utils";

type Props = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  active: boolean;
  /** The sidebar is collapsed to icons on desktop. */
  collapsed: boolean;
  className: string;
  /** Hover text. By default, the label when the sidebar is collapsed. */
  title?: string;
  /** A small second line under the label, for example a warning about the page. */
  note?: string;
  onNavigate: (event: MouseEvent, to: string) => void;
};

/** One top-level sidebar link: icon plus label, the label hidden when the sidebar is collapsed. */
export function SidebarNavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  className,
  title,
  note,
  onNavigate,
}: Props) {
  return (
    <a
      href={href}
      className={className}
      aria-current={active ? "page" : undefined}
      title={title ?? (collapsed ? label : undefined)}
      onClick={(event) => onNavigate(event, href)}
    >
      <Icon className="size-4 shrink-0" aria-hidden={true} />
      <span className={cn("min-w-0 break-words text-start", collapsed && "md:sr-only")}>
        {label}
        {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
      </span>
    </a>
  );
}
