import { useEffect, useState } from "react";
import { compactField, Select } from "$lib/components/ui/select";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
} from "$lib/settings-api";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import { useSettingsText } from "$lib/i18n/settings";
import { captureLanguageOptions, currentCaptureLanguage } from "$lib/capture-language";
import { ReadOnlyNote } from "./ReadOnlyNote";

type Snapshot = {
  readOnly?: boolean;
  revision: string;
  settings: Record<string, { value?: unknown }>;
};

export function CaptureLanguageField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled: boolean;
}) {
  const s = useSettingsText();
  return (
    <div className={compactField}>
      <Select
        id="capture-language"
        className="w-full rounded-lg border border-border bg-background p-2 text-sm"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="auto">{s("Automatic")}</option>
        {captureLanguageOptions(value).map((entry) => (
          <option value={entry.code} key={entry.code}>
            {entry.name ?? entry.code}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function CaptureLanguageSection() {
  const s = useSettingsText();
  const { ask, dialog } = useSettingsConfirm();
  const { changes } = useSettingsChanges();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  /** The language picked while the dialog asks. Cancel puts the saved one back. */
  const [pending, setPending] = useState<string>();
  useEffect(() => {
    let active = true;
    const read = beginSettingsRead();
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active && read.isCurrent()) setSnapshot(value);
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
  const readOnly = snapshot?.readOnly === true;
  const saved = currentCaptureLanguage(snapshot?.settings.autoCaptureLanguage?.value);
  const language = (code: unknown) =>
    code === "auto"
      ? s("Automatic")
      : (captureLanguageOptions(String(code)).find((entry) => entry.code === code)?.name ??
        String(code));
  const fields = [{ key: "autoCaptureLanguage", label: s("Summary language"), print: language }];

  /** Asks first. The picker shows the picked language until the dialog closes. */
  function choose(code: string) {
    if (!snapshot) return;
    const edits = { autoCaptureLanguage: code };
    setPending(code);
    ask({
      title: s("Change the summary language?"),
      body: <SettingsChangeList changes={changes({ autoCaptureLanguage: saved }, edits, fields)} />,
      confirmLabel: s("Save"),
      busyLabel: s("Saving…"),
      onCancel: () => setPending(undefined),
      run: async () => {
        setBusy(true);
        let failure: string | undefined;
        try {
          await settingsRequest("/api/settings", {
            method: "PATCH",
            body: JSON.stringify({ edits, revision: snapshot.revision }),
          });
        } catch (error) {
          failure = (error as Error).message;
        }
        await reloadSettingsSnapshot<Snapshot>();
        setBusy(false);
        // The card's own feedback stays; the dialog keeps the reason too until the user decides.
        if (failure !== undefined) {
          setMessage(failure);
          return { success: false, error: failure };
        }
        // The reloaded snapshot shows the saved language, so the picked one can go.
        setPending(undefined);
        setMessage(s("Saved. New memories use this language."));
        return { success: true };
      },
    });
  }
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Memory language")}
    >
      <h2 className="text-section-title font-semibold">{s("Memory language")}</h2>
      <p className="text-sm text-muted-foreground">
        {s(
          "The language that new memory summaries are written in. Automatic detects it from your prompt, but a Latin-script prompt under 100 characters counts as English."
        )}
      </p>
      <label className="block space-y-1 text-sm" htmlFor="capture-language">
        {s("Summary language")}
      </label>
      <CaptureLanguageField
        value={pending ?? saved}
        disabled={busy || !snapshot || readOnly}
        onChange={(code) => choose(code)}
      />
      <ReadOnlyNote show={readOnly} />
      {dialog}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
