import { useCallback, useMemo, useState } from "react";
import type { Memorisation } from "$lib/memorisation-model";

/** Select mode of the list: whether it is on and which records are ticked. */
export type Selection = {
  on: boolean;
  /** Ticked IDs that are still in the list. A filter or a refresh drops the rest. */
  ids: ReadonlySet<string>;
  start: () => void;
  cancel: () => void;
  toggle: (id: string, checked: boolean) => void;
  addAll: (ids: readonly string[]) => void;
};

/** A record in a linked space is read-only, so it can never be ticked. */
export const isSelectable = (item: Memorisation) => !item.space;

export function useMemorisationSelection(items: readonly Memorisation[] | null): Selection {
  const [state, setState] = useState<{ on: boolean; ids: ReadonlySet<string> }>({
    on: false,
    ids: new Set(),
  });

  // Ticks on records that a new filter hides would be deleted unseen, so they do not count.
  const ids = useMemo(() => {
    const shown = new Set((items ?? []).filter(isSelectable).map((item) => item.id));
    return new Set([...state.ids].filter((id) => shown.has(id)));
  }, [items, state.ids]);

  const start = useCallback(() => setState({ on: true, ids: new Set() }), []);
  const cancel = useCallback(() => setState({ on: false, ids: new Set() }), []);
  const toggle = useCallback(
    (id: string, checked: boolean) =>
      setState((current) => {
        const next = new Set(current.ids);
        if (checked) next.add(id);
        else next.delete(id);
        return { ...current, ids: next };
      }),
    []
  );
  const addAll = useCallback(
    (more: readonly string[]) =>
      setState((current) => ({ ...current, ids: new Set([...current.ids, ...more]) })),
    []
  );

  return { on: state.on, ids, start, cancel, toggle, addAll };
}
