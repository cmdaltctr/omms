import { useCallback, useState } from "react";
import { announceSpacesChanged } from "$lib/spaces-store";
import { refreshWebStatus } from "$lib/web-status";
import { spacesApi, type SpaceResult, type SpacesSnapshot } from "$lib/spaces-api";

/**
 * The spaces list and the one action that runs now. `run` shows `message` while the call is
 * open, then reloads the list and the shared status, and tells the sidebar tree, so both follow at once.
 * The caller reads the result and says what happened.
 */
export function useSpaces() {
  const [snapshot, setSnapshot] = useState<SpacesSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await spacesApi.list();
    setLoading(false);
    if (result.success && result.data) {
      setSnapshot(result.data);
      setLoadError("");
    } else {
      setLoadError(result.error ?? "");
    }
  }, []);

  const run = useCallback(
    async <T>(message: string, call: () => Promise<SpaceResult<T>>) => {
      setBusy(message);
      const result = await call();
      if (result.success) {
        await load();
        await refreshWebStatus();
        announceSpacesChanged();
      }
      setBusy(null);
      return result;
    },
    [load]
  );

  return { snapshot, loading, loadError, busy, load, run };
}
