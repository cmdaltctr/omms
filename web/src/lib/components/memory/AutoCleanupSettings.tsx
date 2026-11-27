import { useEffect, useState } from "react";
import { onSettingsSnapshot, reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { SettingRow } from "$lib/components/settings/SettingRow";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Switch } from "$lib/components/ui/switch";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import type { ConfirmResult } from "$lib/components/settings/SettingsConfirmDialog";
import { useCatalogueText } from "$lib/i18n/settings-catalogue";
import { useSettingsText } from "$lib/i18n/settings";
import { enabledEdit, intervalEdit } from "./auto-cleanup-settings-state";

type Snapshot = {
  revision: string;
  readOnly?: boolean;
  settings: Record<string, { globalValue?: unknown }>;
};

const DEFAULT_INTERVAL = 500;

/**
 * The switch and the interval of the automatic profile cleanup, in the Profile learning card.
 * Both stay in the form until one Save writes them through the global save. A save applies at
 * the next learning pass, so no restart is needed.
 */
export function AutoCleanupSettings() {
  const s = useSettingsText();
  const t = useCatalogueText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [enabled, setEnabled] = useState<boolean>();
  const [draft, setDraft] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useSettingsConfirm();
  const { changes, name } = useSettingsChanges();

  const savedEnabled = snapshot?.settings.userProfileAutoCleanupEnabled?.globalValue !== false;
  const savedInterval = Number(
    snapshot?.settings.userProfileAutoCleanupInterval?.globalValue ?? DEFAULT_INTERVAL
  );
  const nextEnabled = enabled ?? savedEnabled;
  const readOnly = snapshot?.readOnly === true;
  const changed = nextEnabled !== savedEnabled || draft.trim() !== String(savedInterval);

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

  async function save(edits: Record<string, unknown>): Promise<ConfirmResult> {
    if (!snapshot) return { success: false };
    setBusy(true);
    let failure: string | undefined;
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
      setEnabled(undefined);
      setMessage(s("Saved. Changes apply at the next learning pass."));
    } catch (error) {
      failure = (error as Error).message;
      setMessage(failure);
    }
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
    return failure === undefined ? { success: true } : { success: false, error: s(failure) };
  }

  function saveAll() {
    const result = intervalEdit(savedInterval, draft);
    if (result.kind === "error") {
      setFieldError(s(result.message));
      return;
    }
    setFieldError("");
    const edits = {
      ...enabledEdit(savedEnabled, nextEnabled),
      ...(result.kind === "edit" ? result.edits : {}),
    };
    if (Object.keys(edits).length === 0) return;
    const inForce = {
      userProfileAutoCleanupEnabled: savedEnabled,
      userProfileAutoCleanupInterval: savedInterval,
    };
    const fields = [
      { key: "userProfileAutoCleanupEnabled", label: name("userProfileAutoCleanupEnabled") },
      {
        key: "userProfileAutoCleanupInterval",
        label: name("userProfileAutoCleanupInterval"),
        default: DEFAULT_INTERVAL,
        print: (value: unknown) => `${String(value)} ${s("prompts")}`,
      },
    ];
    ask({
      title: s("Save automatic profile cleanup?"),
      body: <SettingsChangeList changes={changes(inForce, edits, fields)} />,
      confirmLabel: s("Save"),
      busyLabel: s("Saving…"),
      run: () => save(edits),
    });
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <h3 className="text-sm font-semibold">{s("Automatic profile cleanup")}</h3>
      <p className="text-sm text-muted-foreground">
        {s(
          "After a learning pass, OMMS merges duplicate profile items and removes vague ones by itself, in the background. Each run makes about one model call for every 100 items and takes several minutes on a large profile. Undo last automatic cleanup on the Profile page puts the changes back."
        )}
      </p>
      <SettingRow setting="userProfileAutoCleanupEnabled" controlId="auto-cleanup-enabled">
        {/* A native switch: the shared Checkbox needs React context that the Shared view specs
            mock away. It stays in form state and saves with the Save button below. */}
        <Switch
          id="auto-cleanup-enabled"
          checked={nextEnabled}
          disabled={busy || !snapshot}
          onCheckedChange={(checked) => {
            setEnabled(checked);
            setMessage("");
          }}
        />
      </SettingRow>
      <SettingRow setting="userProfileAutoCleanupInterval" controlId="auto-cleanup-interval">
        <Input
          id="auto-cleanup-interval"
          className="w-28"
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
      </SettingRow>
      {fieldError && (
        <p id="auto-cleanup-interval-error" role="alert" className="text-sm text-destructive">
          {fieldError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={busy || !snapshot || readOnly || !changed}
          onClick={saveAll}
        >
          {s("Save")}
        </Button>
        {readOnly ? (
          <p className="text-xs text-muted-foreground">
            {t("Saving is turned off until the file is fixed.")}
          </p>
        ) : null}
      </div>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {dialog}
    </div>
  );
}
