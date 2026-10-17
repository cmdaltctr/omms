import { useEffect, useState } from "react";
import { onSettingsSnapshot, reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { enabledEdit, intervalEdit } from "./auto-cleanup-settings-state";

type Snapshot = {
  revision: string;
  settings: Record<string, { globalValue?: unknown }>;
};

const DEFAULT_INTERVAL = 500;

/**
 * The switch and the interval of the automatic profile cleanup, in the Profile learning card.
 * It saves through the same global save as the other settings. A save applies at the next
 * learning pass, so no restart is needed.
 */
export function AutoCleanupSettings() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const savedEnabled = snapshot?.settings.userProfileAutoCleanupEnabled?.globalValue !== false;
  const savedInterval = Number(
    snapshot?.settings.userProfileAutoCleanupInterval?.globalValue ?? DEFAULT_INTERVAL
  );

  useEffect(() => {
    let active = true;
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    const unsubscribe = onSettingsSnapshot((value) => {
      if (active) setSnapshot(value as Snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // The field shows the saved value again after a save or a reload.
  useEffect(() => {
    if (snapshot) setDraft(String(savedInterval));
  }, [snapshot, savedInterval]);

  async function save(edits: Record<string, unknown>) {
    if (!snapshot) return;
    setBusy(true);
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
      setMessage(s("Saved. Changes apply at the next learning pass."));
    } catch (error) {
      setMessage((error as Error).message);
    }
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
  }

  function saveInterval() {
    const result = intervalEdit(savedInterval, draft);
    if (result.kind === "error") {
      setFieldError(s(result.message));
      return;
    }
    setFieldError("");
    if (result.kind === "edit") void save(result.edits);
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="text-sm font-semibold">{s("Automatic profile cleanup")}</h3>
      <p className="text-sm text-muted-foreground">
        {s(
          "After a learning pass, OMMS merges duplicate profile items and removes vague ones by itself, in the background. Each run makes about one model call for every 100 items and takes several minutes on a large profile. Undo last automatic cleanup on the Profile page puts the changes back."
        )}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={savedEnabled}
          disabled={busy || !snapshot}
          onChange={(event) => {
            const edit = enabledEdit(savedEnabled, event.target.checked);
            if (edit) void save(edit);
          }}
        />
        {s("Clean up the profile automatically")}
      </label>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="auto-cleanup-interval">{s("Run every this many analysed prompts")}</label>
        <input
          id="auto-cleanup-interval"
          className="w-28 rounded border border-border bg-background px-2 py-1"
          inputMode="numeric"
          value={draft}
          disabled={busy || !snapshot}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? "auto-cleanup-interval-error" : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setFieldError("");
          }}
        />
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5"
          disabled={busy || !snapshot || draft.trim() === String(savedInterval)}
          onClick={saveInterval}
        >
          {s("Save interval")}
        </button>
      </div>
      {fieldError && (
        <p id="auto-cleanup-interval-error" role="alert" className="text-sm text-destructive">
          {fieldError}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
