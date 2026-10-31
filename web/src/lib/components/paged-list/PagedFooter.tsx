import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "$lib/components/ui/pagination";
import { useSettingsText } from "$lib/i18n/settings";
import { fill } from "$lib/skills-model";
import { getPageRange } from "./paging";
import type { PagingView } from "./use-paging";

type FooterView = Pick<PagingView, "page" | "pageCount" | "from" | "to" | "total" | "setPage">;

/**
 * "Showing 1 to 5 of 25 results" over Previous, page numbers and Next.
 * Renders nothing when the list fits on one page.
 */
export function PagedFooter({ view }: { view: FooterView }) {
  const s = useSettingsText();
  const nav = useRef<HTMLElement>(null);
  // Previous or Next turns disabled on the first or last page; focus moves to the current page.
  const keepFocus = useRef(false);
  useEffect(() => {
    if (!keepFocus.current) return;
    keepFocus.current = false;
    nav.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus();
  }, [view.page]);

  const items = getPageRange(view.page, view.pageCount);
  if (items.length === 0) return null;
  const go = (page: number) => {
    keepFocus.current = page === 1 || page === view.pageCount;
    view.setPage(page);
  };

  return (
    <div className="flex flex-col items-center gap-3 pt-1">
      <p className="text-sm text-muted-foreground tabular-nums">
        {fill(s("Showing {from} to {to} of {total} results"), {
          from: view.from,
          to: view.to,
          total: view.total,
        })}
      </p>
      <Pagination ref={nav} aria-label={s("pagination")}>
        <PaginationContent>
          <PaginationItem>
            <PaginationButton
              size="sm"
              className="gap-1 px-2.5"
              aria-label={s("Go to previous page")}
              disabled={view.page <= 1}
              onClick={() => go(view.page - 1)}
            >
              <ChevronLeft className="rtl:-scale-x-100" aria-hidden="true" />
              <span className="hidden sm:inline">{s("Previous")}</span>
            </PaginationButton>
          </PaginationItem>
          {items.map((item, index) =>
            item === "..." ? (
              <PaginationItem key={`gap-${index}`}>
                <PaginationEllipsis label={s("More pages")} />
              </PaginationItem>
            ) : (
              <PaginationItem key={item}>
                <PaginationButton
                  isActive={item === view.page}
                  aria-label={fill(s("Go to page {page}"), { page: item })}
                  onClick={() => (item === view.page ? undefined : go(item))}
                >
                  {item}
                </PaginationButton>
              </PaginationItem>
            )
          )}
          <PaginationItem>
            <PaginationButton
              size="sm"
              className="gap-1 px-2.5"
              aria-label={s("Go to next page")}
              disabled={view.page >= view.pageCount}
              onClick={() => go(view.page + 1)}
            >
              <span className="hidden sm:inline">{s("Next")}</span>
              <ChevronRight className="rtl:-scale-x-100" aria-hidden="true" />
            </PaginationButton>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
