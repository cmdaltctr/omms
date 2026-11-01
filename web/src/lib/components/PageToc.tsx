import { useState, type MouseEvent } from "react";
import { ArrowLeft, List } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import { flashAnchor, JUMP } from "$lib/settings-navigation";

/** One entry of the contents list: the section's anchor id and English title. */
export type TocSection = { id: string; title: string };

/** The saved choice. Blocked storage leaves the contents open for this visit. */
function readOpen(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) !== "0";
  } catch {
    return true;
  }
}

function saveOpen(storageKey: string, open: boolean): void {
  try {
    localStorage.setItem(storageKey, open ? "1" : "0");
  } catch {
    // Blocked storage: the choice lasts for this visit.
  }
}

/**
 * The floating table of contents of a long view: one small control fixed at
 * the top end of the screen, out of the page flow, so the top of the view
 * keeps all its space. The list starts with the optional way back, then the
 * view's sections in page order. The icon minimises the list and expands it
 * again; a section link scrolls to its section at once and outlines it for a
 * moment, the same jump the sidebar uses. The choice persists per browser
 * under the page's own storage key.
 */
export function PageToc({
  storageKey,
  sections,
  back,
}: {
  /** localStorage key for this page's expanded or minimised choice. */
  storageKey: string;
  sections: readonly TocSection[];
  /** The way back, shown above the sections; a top-level page omits it. */
  back?: { label: string; onBack: () => void };
}) {
  const s = useSettingsText();
  const [open, setOpen] = useState(() => readOpen(storageKey));
  const toggle = () =>
    setOpen((was) => {
      saveOpen(storageKey, !was);
      return !was;
    });
  const jump = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView(JUMP);
    flashAnchor(element);
  };
  return (
    // Floating and fixed: it takes no space at the top of the view. top-16
    // clears the mobile header bar; the desktop pages have none.
    <div className="fixed top-16 end-3 z-20 flex flex-col items-end gap-1 md:top-3">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-expanded={open}
        aria-controls={`${storageKey}-nav`}
        aria-label={s(open ? "Hide contents" : "Show contents")}
        onClick={toggle}
        className="bg-card/95 shadow-sm backdrop-blur"
      >
        <List className="size-4" aria-hidden="true" />
      </Button>
      {open ? (
        <nav
          id={`${storageKey}-nav`}
          aria-label={s("Contents")}
          className="max-h-[70vh] w-48 max-w-full overflow-y-auto rounded-xl border border-border bg-card/95 px-2 py-1.5 shadow-sm backdrop-blur"
        >
          <ul>
            {back ? (
              <li className="mb-1 border-b border-border pb-1">
                <button
                  type="button"
                  onClick={back.onBack}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-interactive-hover"
                >
                  <ArrowLeft className="rtl:-scale-x-100 size-3.5 shrink-0" aria-hidden="true" />
                  {back.label}
                </button>
              </li>
            ) : null}
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={jump(section.id)}
                  className="block rounded-lg px-2 py-1.5 text-start text-sm hover:bg-interactive-hover"
                >
                  {s(section.title)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
