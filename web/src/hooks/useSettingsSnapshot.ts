import { useEffect, useState } from "react";
import { beginSettingsRead, onSettingsSnapshot, settingsRequest } from "$lib/settings-api";

/**
 * The settings snapshot for a card: one read when the card mounts, then every snapshot that a
 * save in any card publishes. A slow first read never replaces a newer one.
 */
export function useSettingsSnapshot<T>() {
  const [snapshot, setSnapshot] = useState<T>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const read = beginSettingsRead();
    void settingsRequest<T>("/api/settings")
      .then((value) => {
        if (active && read.isCurrent()) setSnapshot(value);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    const unsubscribe = onSettingsSnapshot((value) => {
      if (active) setSnapshot(value as T);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return { snapshot, error };
}
