import { useEffect, useRef, useState } from "react";
import {
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withBusy,
} from "$lib/settings-api";

export type SettingEntry = { value?: unknown; globalValue?: unknown; source?: string };
export type SettingsSnapshot = { revision: string; settings: Record<string, SettingEntry> };

/**
 * The settings snapshot plus a save that sends the revision it last saw, like
 * the other Settings cards. `save` resolves to an error message, or null.
 */
export function useSkillSettings() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    settingsRequest<SettingsSnapshot>("/api/settings")
      .then((value) => {
        if (mounted.current) setSnapshot(value);
      })
      .catch((error: Error) => {
        if (mounted.current) setLoadError(error.message);
      });
    const stop = onSettingsSnapshot((value) => {
      if (mounted.current) setSnapshot(value as SettingsSnapshot);
    });
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);

  async function save(edits: Record<string, unknown>): Promise<string | null> {
    if (!snapshot) return loadError || "Settings are not loaded";
    let failure: string | null = null;
    await withBusy(setBusy, async () => {
      try {
        await settingsRequest("/api/settings", {
          method: "PATCH",
          body: JSON.stringify({ edits, revision: snapshot.revision }),
        });
      } catch (error) {
        failure = (error as Error).message;
      }
      await reloadSettingsSnapshot<SettingsSnapshot>();
    });
    return failure;
  }
  return { snapshot, loadError, busy, save };
}
