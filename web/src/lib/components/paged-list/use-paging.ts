import { useMemo, useState } from "react";
import {
  DEFAULT_PER_PAGE,
  migrateView,
  pageWindow,
  readView,
  saveView,
  sortItems,
  syncPaged,
  type PageWindow,
  type SavedView,
  type SortOrder,
} from "./paging";

/** One entry of the "Sort by" menu. `label` is the English message; the toolbar translates it. */
export type SortChoice<S extends string> = {
  value: S;
  label: string;
  first: SortOrder;
  /** The sort that shows the same rows the other way round, for example Newest and Oldest. */
  flip?: S;
};
/** A sort the browser runs. `compare` gives the ascending order. */
export type SortOption<S extends string, T> = SortChoice<S> & {
  compare: (a: T, b: T) => number;
  /** Rows that always come last, whichever way the sort runs, such as a missing date. */
  last?: (item: T) => boolean;
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
  /** An older key whose saved view moves to `storageKey` once, when `storageKey` holds nothing. */
  legacyKey?: string;
  /** Page size before the reader picks one. A saved size wins. Defaults to 5. */
  defaultPerPage?: number;
};

/**
 * The entry to save. The page size goes in only when the reader chose it, so a
 * later change of the default reaches readers who never picked a size.
 */
export function viewToSave<S extends string>(
  view: { perPage: number; sort: S; order: SortOrder },
  sizeChosen: boolean
): SavedView<S> {
  const { perPage, ...rest } = view;
  return sizeChosen ? { perPage, ...rest } : rest;
}

export function initialView<S extends string>(
  storageKey: string,
  sorts: readonly SortChoice<S>[],
  defaultPerPage = DEFAULT_PER_PAGE
) {
  const saved = readView<S>(storageKey);
  const choice = sorts.find((option) => option.value === saved?.sort) ?? sorts[0];
  return {
    perPage: saved?.perPage ?? defaultPerPage,
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
  legacyKey,
  defaultPerPage,
}: Options<S>): PagingView<S> {
  const [view, setView] = useState(() => {
    if (legacyKey) migrateView(storageKey, legacyKey);
    return initialView(storageKey, sorts, defaultPerPage);
  });
  const [sizeChosen, setSizeChosen] = useState(() => readView(storageKey)?.perPage !== undefined);
  const [paged, setPaged] = useState({ page: 1, key: resetKey });
  // A new key drops the stored page, so returning to an earlier key starts at page 1.
  const current = syncPaged(paged, resetKey);
  if (current !== paged) setPaged(current);
  const place = pageWindow(current.page, view.perPage, total);

  const update = (next: typeof view, chosen = sizeChosen) => {
    setView(next);
    setSizeChosen(chosen);
    saveView(storageKey, viewToSave(next, chosen));
    setPaged({ page: 1, key: resetKey });
  };
  return {
    ...place,
    ...view,
    sorts,
    setPage: (page) => setPaged({ page, key: resetKey }),
    setPerPage: (perPage) => update({ ...view, perPage }, true),
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
  const { compare, last } = sorts.find((option) => option.value === view.sort) ?? sorts[0];
  const sorted = useMemo(
    () => sortItems(items, compare, view.order, last),
    [items, compare, last, view.order]
  );
  const pageItems = sorted.slice(Math.max(0, view.from - 1), view.to);
  return { view, pageItems };
}
