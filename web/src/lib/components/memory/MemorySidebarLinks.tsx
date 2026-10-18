import type { MouseEvent, ReactNode } from "react";
import { ROUTES } from "$lib/routes";

export type MemorySidebarSection = {
  id: string;
  label: string;
  avatar?: ReactNode;
  warning?: boolean;
  /** Contents of the view: each links to a row on that view's page. */
  items?: { id: string; label: string }[];
};

/** The Memory views under the Memory entry in the sidebar: host avatars, and a marker when memories are not saved. */
export function MemorySidebarLinks({
  sections,
  currentView,
  memoryViewId,
  warningLabel,
  className,
  onSectionClick,
}: {
  sections: MemorySidebarSection[];
  currentView: string;
  memoryViewId: string | null;
  warningLabel: string;
  className: string;
  onSectionClick: (event: MouseEvent, id: string, view: "memory") => void;
}) {
  return (
    <ul id="sidebar-memory-tree" className={className}>
      {sections.map((section) => (
        <li key={section.id}>
          <a
            href={`${ROUTES.memory}/${section.id}`}
            aria-current={
              currentView === "memory" && memoryViewId === section.id ? "page" : undefined
            }
            className="flex min-h-11 md:min-h-7 items-center gap-2 break-words rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-interactive-hover focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
            onClick={(event) => onSectionClick(event, section.id, "memory")}
          >
            {section.avatar}
            {section.label}
            {section.warning && (
              <span
                role="img"
                aria-label={warningLabel}
                title={warningLabel}
                className="ms-auto size-2 shrink-0 rounded-full bg-[var(--status-warning)]"
              />
            )}
          </a>
          {section.items && section.items.length > 0 && (
            <ul
              aria-label={section.label}
              className="ms-4 mt-0.5 space-y-0.5 border-s border-sidebar-border ps-2"
            >
              {section.items.map((item) => (
                <li key={item.id}>
                  <a
                    // The click handler reads `view#row` as a path with an anchor.
                    href={`${ROUTES.memory}/${section.id}#${item.id}`}
                    className="flex min-h-11 md:min-h-7 items-center break-words rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-interactive-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={(event) => onSectionClick(event, `${section.id}#${item.id}`, "memory")}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
