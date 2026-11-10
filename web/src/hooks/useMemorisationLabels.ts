import { useCallback, useState } from "react";
import { labelsFromSearch, searchWithLabels, withLabel } from "$lib/memorisation-query";

/** Writes the labels into the address bar without a new history entry or a page load. */
function writeUrl(labels: readonly string[]) {
  const { pathname, search, hash } = window.location;
  window.history.replaceState(
    window.history.state,
    "",
    `${pathname}${searchWithLabels(search, labels)}${hash}`
  );
}

/**
 * The label filter of the Memorisation list. It starts from `?labels=a,b` in the address bar
 * and writes every change back, so a reload keeps the filter.
 */
export function useMemorisationLabels() {
  const [labels, setLabels] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : labelsFromSearch(window.location.search ?? "")
  );

  const change = useCallback((next: string[]) => {
    setLabels(next);
    writeUrl(next);
  }, []);

  const addLabel = useCallback(
    (label: string) => {
      const next = withLabel(labels, label);
      if (next.length !== labels.length) change(next);
    },
    [change, labels]
  );
  const removeLabel = useCallback(
    (label: string) => change(labels.filter((own) => own.toLowerCase() !== label.toLowerCase())),
    [change, labels]
  );
  const clearLabels = useCallback(() => change([]), [change]);

  return { labels, addLabel, removeLabel, clearLabels };
}
