import { useMemo, useState } from "react";
import {
  DEFAULT_PER_PAGE,
  pageWindow,
  readView,
  saveView,
  sortItems,
  type PageWindow,
  type SortOrder,
} from "./paging";

/** One entry of the "Sort by" menu. `label` is the English message; the toolbar translates it. */
export type SortChoice<S extends string> = { value: S; label: string; first: SortOrder };
/** A sort the browser runs. `compare` gives the ascending order. */
export type SortOption<S extends string, T> = SortChoice<S> & {
  compare: (a: T, b: T) => number;
};

/** Everything the toolbar and footer need. Pass it to `PagedList` as `view`. */
export type PagingView<S extends string = string> = PageWindow & {
  perPage: number;
  sort: S;
  order: SortOrder;
  sorts: readonly SortChoice<S>[];
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setSort: (sort: S, order: SortOrder) => void;
};

type Options<S extends string> = {
  /** localStorage key for this list's page size and sort. One key per list. */
  storageKey: string;
  /** Rows in the whole list. For a server-paged list, the total the server reported. */
  total: number;
  sorts: readonly SortChoice<S>[];
  /** A new value (for example a new filter) returns the list to page 1. */
  resetKey?: string;
};

function initialView<S extends string>(storageKey: string, sorts: readonly SortChoice<S>[]) {
  const saved = readView<S>(storageKey);
  const choice = sorts.find((option) => option.value === saved?.sort) ?? sorts[0];
  return {
    perPage: saved?.perPage ?? DEFAULT_PER_PAGE,
    sort: choice.value,
    order: (saved?.sort === choice.value ? saved.order : undefined) ?? choice.first,
  };
}

/**
 * Page size, sort and page for one list. The page size and sort persist per
 * list; changing either returns to page 1; the page stays inside the list
 * when the data shrinks. Works for browser-held and server-paged lists.
 */
export function usePaging<S extends string>({
  storageKey,
  total,
  sorts,
  resetKey = "",
}: Options<S>): PagingView<S> {
  const [view, setView] = useState(() => initialView(storageKey, sorts));
  const [paged, setPaged] = useState({ page: 1, key: resetKey });
  const requested = paged.key === resetKey ? paged.page : 1;
  const place = pageWindow(requested, view.perPage, total);

  const update = (next: typeof view) => {
    setView(next);
    saveView(storageKey, next);
    setPaged({ page: 1, key: resetKey });
  };
  return {
    ...place,
    ...view,
    sorts,
    setPage: (page) => setPaged({ page, key: resetKey }),
    setPerPage: (perPage) => update({ ...view, perPage }),
    setSort: (sort, order) => update({ ...view, sort, order }),
  };
}

/** A list held in the browser: sorts every row, then returns the rows of the current page. */
export function usePagedList<T, S extends string>({
  items,
  sorts,
  ...options
}: Omit<Options<S>, "total" | "sorts"> & {
  items: readonly T[];
  sorts: readonly SortOption<S, T>[];
}) {
  const view = usePaging({ ...options, sorts, total: items.length });
  const compare = (sorts.find((option) => option.value === view.sort) ?? sorts[0]).compare;
  const sorted = useMemo(() => sortItems(items, compare, view.order), [items, compare, view.order]);
  const pageItems = sorted.slice(Math.max(0, view.from - 1), view.to);
  return { view, pageItems };
}
