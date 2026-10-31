/**
 * Pure paging helpers for the shared paged list. Ported from the receipt
 * scanner's `lib/pagination.ts` and `usePerPageInput`, for lists that page in
 * the browser or ask the server for one window at a time.
 */

/** Page sizes in the "Show" menu, the same on every list. */
export const PER_PAGE_PRESETS = [3, 5, 10, 25, 50, 100] as const;
export const DEFAULT_PER_PAGE = 5;
/** Largest page size a list accepts. The skills routes check the same limit. */
export const MAX_PER_PAGE = 200;

export type SortOrder = "asc" | "desc";
/** A page item is either a page number or an ellipsis gap marker. */
export type PageItem = number | "...";

const range = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i);

/**
 * Page numbers for a sliding window. The first and last pages always show;
 * `siblings` pages sit on each side of the current page; `"..."` fills a gap.
 * Page 6 of 11 gives `[1, "...", 5, 6, 7, "...", 11]`. One page gives `[]`.
 */
export function getPageRange(current: number, total: number, siblings = 1): PageItem[] {
  if (total <= 1) return [];
  // First + last + current + siblings on both sides + up to two gaps.
  if (total <= siblings * 2 + 5) return range(1, total);
  const left = Math.max(current - siblings, 1);
  const right = Math.min(current + siblings, total);
  const leftGap = left > 2;
  const rightGap = right < total - 1;
  const edge = 3 + siblings * 2;
  if (!leftGap && rightGap) return [...range(1, edge), "...", total];
  if (leftGap && !rightGap) return [1, "...", ...range(total - edge + 1, total)];
  return [1, "...", ...range(left, right), "...", total];
}

export const pageCount = (total: number, perPage: number): number =>
  Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, perPage)));

/** Keep a page inside the list, for example after the data shrinks. */
export const clampPage = (page: number, total: number, perPage: number): number =>
  Math.min(Math.max(1, Math.floor(page) || 1), pageCount(total, perPage));

export type PageWindow = {
  page: number;
  pageCount: number;
  /** 1-based index of the first row shown, or 0 for an empty list. */
  from: number;
  to: number;
  total: number;
};

export function pageWindow(page: number, perPage: number, total: number): PageWindow {
  const current = clampPage(page, total, perPage);
  const from = total === 0 ? 0 : (current - 1) * perPage + 1;
  return {
    page: current,
    pageCount: pageCount(total, perPage),
    from,
    to: Math.min(total, current * perPage),
    total,
  };
}

/** The rows on one page of a list held in the browser. */
export function paginate<T>(items: readonly T[], page: number, perPage: number) {
  const view = pageWindow(page, perPage, items.length);
  return { ...view, items: items.slice(Math.max(0, view.from - 1), view.to) };
}

/**
 * The window to ask the server for. The server lists newest first; for an
 * oldest-first view this asks for the matching window from the end and the
 * caller reverses the rows.
 */
export function serverWindow(page: number, perPage: number, total: number, oldestFirst: boolean) {
  const { from, to } = pageWindow(page, perPage, total);
  if (!oldestFirst || total === 0) return { offset: Math.max(0, from - 1), limit: perPage };
  return { offset: total - to, limit: to - from + 1 };
}

/** The presets, plus a custom size in its sorted place so the menu never shows blank. */
export function sizeOptions(perPage: number): number[] {
  const presets: number[] = [...PER_PAGE_PRESETS];
  return presets.includes(perPage) ? presets : [...presets, perPage].sort((x, y) => x - y);
}

/** A typed custom size, clamped to 1–200. Text that is not a positive number keeps `current`. */
export function parseCustomSize(input: string, current: number): number {
  const n = Number.parseInt(input.trim(), 10);
  if (Number.isNaN(n) || n < 1) return current;
  return Math.min(n, MAX_PER_PAGE);
}

/**
 * Sort a copy. `compare` gives the ascending order; descending flips it. Rows
 * that compare equal keep their input order in both directions. Rows that
 * `last` accepts (for example a missing date) stay at the end in both directions.
 */
export function sortItems<T>(
  items: readonly T[],
  compare: (a: T, b: T) => number,
  order: SortOrder,
  last?: (item: T) => boolean
): T[] {
  const sign = order === "asc" ? 1 : -1;
  const tail = (item: T) => (last?.(item) ? 1 : 0);
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        tail(a.item) - tail(b.item) ||
        (tail(a.item) ? 0 : sign * compare(a.item, b.item)) ||
        a.index - b.index
    )
    .map(({ item }) => item);
}

/** What a list saves. `perPage` is present only when the reader chose a size. */
export type SavedView<S extends string> = { perPage?: number; sort?: S; order?: SortOrder };

/** The saved page size and sort of one list. Blocked storage or bad data gives `null`. */
export function readView<S extends string>(key: string): SavedView<S> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedView<S>>;
    const perPage =
      value.perPage === undefined
        ? undefined
        : parseCustomSize(String(value.perPage), DEFAULT_PER_PAGE);
    const order = value.order === "asc" || value.order === "desc" ? value.order : undefined;
    return { perPage, sort: typeof value.sort === "string" ? value.sort : undefined, order };
  } catch {
    return null;
  }
}

export function saveView<S extends string>(key: string, view: SavedView<S>): void {
  try {
    localStorage.setItem(key, JSON.stringify(view));
  } catch {
    // Private mode or blocked site data; the choice lasts for this visit.
  }
}

/**
 * Carries a list's saved view over from an old key to a new one, once: when
 * the new key holds nothing. The size is copied only when it is not 5, the
 * old default, which cannot be told from a chosen 5. The sort and order are
 * copied as saved. The old key is left as it is.
 */
export function migrateView(newKey: string, oldKey: string): void {
  try {
    if (localStorage.getItem(newKey) !== null) return;
    const old = readView(oldKey);
    if (!old) return;
    const perPage = old.perPage === DEFAULT_PER_PAGE ? undefined : old.perPage;
    if (perPage === undefined && old.sort === undefined && old.order === undefined) return;
    saveView(newKey, { perPage, sort: old.sort, order: old.order });
  } catch {
    // Blocked storage: the list starts at its defaults.
  }
}

/** The page a list asked for, and the reset key it asked under. */
export type PagedState = { page: number; key: string };

/** The stored page for this reset key. A new key drops the old page for good. */
export function syncPaged(state: PagedState, key: string): PagedState {
  return state.key === key ? state : { page: 1, key };
}

/**
 * What the direction button picks. A sort with an opposite (Newest and
 * Oldest) moves to it, so the label always matches the order shown. Any other
 * sort keeps its value and reverses its order.
 */
export function flipSort<S extends string>(
  sorts: readonly { value: S; first: SortOrder; flip?: S }[],
  sort: S,
  order: SortOrder
): { sort: S; order: SortOrder } {
  const opposite = sorts.find(
    (option) => option.value === sorts.find((o) => o.value === sort)?.flip
  );
  if (opposite) return { sort: opposite.value, order: opposite.first };
  return { sort, order: order === "asc" ? "desc" : "asc" };
}
