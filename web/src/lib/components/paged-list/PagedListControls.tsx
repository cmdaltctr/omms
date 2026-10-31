import { useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Select } from "$lib/components/ui/select";
import { useSettingsText } from "$lib/i18n/settings";
import { flipSort, parseCustomSize, sizeOptions } from "./paging";
import type { PagingView } from "./use-paging";

const Bar = () => (
  <span aria-hidden="true" className="hidden text-muted-foreground/50 sm:inline">
    |
  </span>
);

/**
 * "Show [5] results | Custom: [ ] | Sort by [menu] [↑↓]" with the total on
 * the right. A preset size applies at once. The custom box applies on Enter
 * or blur, is clamped to 1–200, and snaps back when the text is not a number.
 */
export function PagedListControls<S extends string>({
  view,
  totalLabel,
}: {
  view: PagingView<S>;
  /** Shown on the right, for example "25 skills". */
  totalLabel: string;
}) {
  const s = useSettingsText();
  // null while the box shows the applied size; text while the reader types.
  const [draft, setDraft] = useState<string | null>(null);
  const submit = () => {
    if (draft === null) return;
    const size = parseCustomSize(draft, view.perPage);
    setDraft(null);
    if (size !== view.perPage) view.setPerPage(size);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") submit();
  };
  const ascending = view.order === "asc";
  const Arrow = ascending ? ArrowUp : ArrowDown;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <span>{s("Show")}</span>
        <Select
          className="h-8 w-fit"
          value={view.perPage}
          aria-label={s("Results per page")}
          onChange={(event) => view.setPerPage(Number(event.target.value))}
        >
          {sizeOptions(view.perPage).map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
        <span>{s("results")}</span>
      </span>
      {/* Each separator travels with the group after it and hides on narrow screens. */}
      <span className="flex items-center gap-2">
        <Bar />
        <span>{s("Custom:")}</span>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={200}
          className="h-8 w-20 tabular-nums"
          value={draft ?? String(view.perPage)}
          aria-label={s("Custom results per page")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={submit}
        />
      </span>
      {view.sorts.length > 0 ? (
        <span className="flex items-center gap-2">
          <Bar />
          <span>{s("Sort by")}</span>
          <Select
            className="h-8 w-fit"
            value={view.sort}
            aria-label={s("Sort by")}
            onChange={(event) => {
              const next = view.sorts.find((option) => option.value === event.target.value);
              if (next) view.setSort(next.value, next.first);
            }}
          >
            {view.sorts.map((option) => (
              <option key={option.value} value={option.value}>
                {s(option.label)}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={s(ascending ? "Sort descending" : "Sort ascending")}
            title={s(ascending ? "Sort descending" : "Sort ascending")}
            onClick={() => {
              const next = flipSort(view.sorts, view.sort, view.order);
              view.setSort(next.sort, next.order);
            }}
          >
            <Arrow className="size-3.5" aria-hidden="true" />
          </Button>
        </span>
      ) : null}
      <span className="ms-auto tabular-nums">{totalLabel}</span>
    </div>
  );
}
