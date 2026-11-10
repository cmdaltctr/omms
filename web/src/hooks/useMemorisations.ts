import { useCallback, useRef, useState } from "react";
import { memorisationApi } from "$lib/memorisation-api";
import { withHosts, type BulkDeleteResult, type Memorisation } from "$lib/memorisation-model";
import { parseRecallInput } from "$lib/memorisation-query";

export type RecallState =
  | { kind: "idle" }
  | { kind: "running"; query: string }
  | { kind: "done"; query: string; matches: Memorisation[] }
  /** `missingId` is set when the server found no record for an ID. */
  | { kind: "failed"; query: string; missingId: boolean };

/**
 * The memorisations of this project that carry all of `labels`, the recall search over them,
 * and delete. Call `load` again whenever `labels` changes: `load` changes with them.
 */
export function useMemorisations(labels: readonly string[]) {
  const [items, setItems] = useState<Memorisation[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [recall, setRecall] = useState<RecallState>({ kind: "idle" });
  // The list knows each record's host and kind, which a recall match lacks. A filtered list
  // knows fewer records, so every record seen so far is kept.
  const known = useRef(new Map<string, Memorisation>());
  // Only the newest list request may set the list: an older one can arrive later.
  const newest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++newest.current;
    const result = await memorisationApi.list(labels);
    if (mine !== newest.current) return;
    if (result.success && result.data) {
      for (const item of result.data.memorisations) known.current.set(item.id, item);
      setItems(result.data.memorisations);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
  }, [labels]);

  const search = useCallback(async (text: string) => {
    const query = text.trim();
    const { q, labels: tags } = parseRecallInput(query);
    if (!q && tags.length === 0) return;
    setRecall({ kind: "running", query });
    const result = await memorisationApi.recall(q, tags);
    if (result.success && result.data) {
      setRecall({
        kind: "done",
        query,
        matches: withHosts(result.data.matches, [...known.current.values()]),
      });
    } else {
      setRecall({
        kind: "failed",
        query,
        missingId: tags.length === 0 && /^ms-[a-z0-9]{6}$/.test(q),
      });
    }
  }, []);

  const clearSearch = useCallback(() => setRecall({ kind: "idle" }), []);

  const leave = useCallback((ids: readonly string[]) => {
    setItems((current) => current?.filter((item) => !ids.includes(item.id)) ?? current);
    setRecall((current) =>
      current.kind === "done"
        ? { ...current, matches: current.matches.filter((match) => !ids.includes(match.id)) }
        : current
    );
  }, []);

  /** Deletes one record. On success the record leaves the list and the recall results. */
  const remove = useCallback(
    async (id: string) => {
      const result = await memorisationApi.remove(id);
      if (result.success) leave([id]);
      return result;
    },
    [leave]
  );

  /** Deletes many records in one request. Resolves to the reply, or null when the request failed. */
  const removeMany = useCallback(
    async (ids: readonly string[]): Promise<BulkDeleteResult | null> => {
      const result = await memorisationApi.removeMany(ids);
      if (!result.success || !result.data) return null;
      leave(result.data.deleted);
      return result.data;
    },
    [leave]
  );

  return { items, loadFailed, recall, load, search, clearSearch, remove, removeMany };
}
