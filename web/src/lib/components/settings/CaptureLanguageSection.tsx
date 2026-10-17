import { useEffect, useState } from "react";
import { Select } from "$lib/components/ui/select";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
} from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { captureLanguageOptions, currentCaptureLanguage } from "$lib/capture-language";

type Snapshot = { revision: string; settings: Record<string, { value?: unknown }> };

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
  );
}

export function CaptureLanguageSection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
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
  async function save(code: string) {
    if (!snapshot) return;
    setBusy(true);
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits: { autoCaptureLanguage: code }, revision: snapshot.revision }),
      });
      setMessage(s("Saved. New memories use this language."));
    } catch (error) {
      setMessage((error as Error).message);
    }
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
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
        value={currentCaptureLanguage(snapshot?.settings.autoCaptureLanguage?.value)}
        disabled={busy || !snapshot}
        onChange={(code) => void save(code)}
      />
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
