import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { ROUTES } from "$lib/routes";
import { cn } from "$lib/utils";

/**
 * The open state of a sidebar tree, saved in this browser under `key`. With no
 * saved choice it starts as `fallback`. Blocked storage leaves the toggle working
 * for this visit.
 */
export function useSavedOpen(key: string, fallback: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? fallback : saved === "1";
    } catch {
      return fallback;
    }
  });
  return [
    open,
    () => {
      const next = !open;
      setOpen(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Storage can be blocked; the toggle still works for this page view.
      }
    },
  ];
}

/** The User profile entry with its toggle, and the Preferences, Patterns and Workflows links under it. */
export function ProfileTree({
  link,
  sections,
  open,
  onToggle,
  label,
  hideWhenCollapsed,
  onSectionClick,
}: {
  link: ReactNode;
  sections: { id: string; label: string }[];
  open: boolean;
  onToggle: () => void;
  label: string;
  /** Classes that hide the toggle and the links when the desktop sidebar is collapsed. */
  hideWhenCollapsed: string;
  onSectionClick: (event: MouseEvent, id: string) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-0.5">
        {link}
        {sections.length > 0 && (
          <button
            type="button"
            className={cn(
              "inline-flex min-h-11 min-w-11 md:min-h-7 md:min-w-7 shrink-0 items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:bg-interactive-hover focus-visible:outline-2 focus-visible:outline-ring",
              hideWhenCollapsed
            )}
            onClick={onToggle}
            aria-expanded={open}
            aria-controls="sidebar-profile-tree"
            aria-label={label}
            title={label}
          >
            <ChevronRight
              className={cn(
                "size-4 transition-transform rtl:-scale-x-100",
                open && "rotate-90 rtl:rotate-90"
              )}
            />
          </button>
        )}
      </div>
      {open && sections.length > 0 && (
        <ul
          id="sidebar-profile-tree"
          className={cn("ms-5 space-y-0.5 border-s border-sidebar-border ps-2", hideWhenCollapsed)}
        >
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`${ROUTES.profile}#${section.id}`}
                className="flex min-h-11 md:min-h-7 items-center break-words rounded-lg px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-interactive-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                onClick={(event) => onSectionClick(event, section.id)}
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
