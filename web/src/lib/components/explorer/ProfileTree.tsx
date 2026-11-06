import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { ROUTES } from "$lib/routes";
import { cn } from "$lib/utils";

/**
 * The open state of a sidebar tree. The user's choice is saved in this browser
 * under `key`. With no choice the tree follows `fallback`, so it opens when the
 * user moves to its page. Blocked storage leaves the toggle working for this visit.
 */
export function useSavedOpen(key: string, fallback: boolean): [boolean, () => void] {
  const [choice, setChoice] = useState<boolean | null>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? null : saved === "1";
    } catch {
      return null;
    }
  });
  const open = choice ?? fallback;
  return [
    open,
    () => {
      const next = !open;
      setChoice(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Storage can be blocked; the toggle still works for this page view.
      }
    },
  ];
}

/**
 * A main link with its toggle and the section links under it. Used for User profile
 * (Preferences, Patterns, Workflows) and for Skills; `id` and `base` default to the profile.
 */
export function ProfileTree({
  link,
  sections,
  open,
  onToggle,
  label,
  hideWhenCollapsed,
  onSectionClick,
  id = "sidebar-profile-tree",
  base = ROUTES.profile,
}: {
  link: ReactNode;
  sections: {
    id: string;
    label: string;
    /** A chip before the label. With it, a long label ends in an ellipsis. */
    leading?: ReactNode;
    /** A mark after the label. */
    trailing?: ReactNode;
    /** Hover text, for a label that may be cut. */
    title?: string;
    /** A page of its own. Without it the row links to an anchor on `base`. */
    href?: string;
    /** The row is the page on screen. */
    current?: boolean;
  }[];
  open: boolean;
  onToggle: () => void;
  label: string;
  /** Classes that hide the toggle and the links when the desktop sidebar is collapsed. */
  hideWhenCollapsed: string;
  onSectionClick: (event: MouseEvent, id: string) => void;
  /** The DOM id of the link list. */
  id?: string;
  /** The page the section anchors belong to. */
  base?: string;
}) {
  return (
    <>
      <div className="flex items-center gap-0.5">
        {link}
        {sections.length > 0 && (
          <button
            type="button"
            className={cn(
              "inline-flex min-h-11 min-w-11 md:min-h-7 md:min-w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:bg-interactive-hover focus-visible:outline-2 focus-visible:outline-ring",
              hideWhenCollapsed
            )}
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={id}
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
          id={id}
          className={cn("ms-5 space-y-0.5 border-s border-sidebar-border ps-2", hideWhenCollapsed)}
        >
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={section.href ?? `${base}#${section.id}`}
                title={section.title}
                aria-current={section.current ? "page" : undefined}
                className="flex min-h-11 md:min-h-7 items-center gap-2 break-words rounded-lg px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-interactive-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
                onClick={(event) => onSectionClick(event, section.id)}
              >
                {section.leading || section.trailing ? (
                  <>
                    {section.leading}
                    <span className="min-w-0 flex-1 truncate">{section.label}</span>
                    {section.trailing}
                  </>
                ) : (
                  section.label
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
