import { useEffect, useRef, useState } from "react";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withNote,
} from "$lib/settings-api";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { Button } from "$lib/components/ui/button";
import { SettingRow } from "$lib/components/settings/SettingRow";
import { Select } from "$lib/components/ui/select";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import type { ConfirmResult } from "$lib/components/settings/SettingsConfirmDialog";
import { useSettingsText } from "$lib/i18n/settings";
import { useCatalogueText } from "$lib/i18n/settings-catalogue";
import { PLAIN_TEXT } from "$lib/settings-catalogue";
import {
  KEYWORD_MODE_OPTIONS,
  isKeywordMode,
  keywordModeSaveEdits,
  modeFromSetting,
  rerankerOverridesMode,
  type KeywordMode,
} from "$lib/keyword-mode-controls";
import { ReadOnlyNote } from "../settings/ReadOnlyNote";

type Setting = { value?: unknown; source: string; globalValue?: unknown };
type Snapshot = { readOnly?: boolean; revision: string; settings: Record<string, Setting> };
type Status =
  { kind: "load-failed" } | { kind: "save"; ok: boolean; reloaded: boolean; stale?: boolean };

/** Choose how word matches join the search results. Merging two ranked lists is experimental. */
export function KeywordModeSection() {
  const s = useSettingsText();
  const t = useCatalogueText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [mode, setMode] = useState<KeywordMode>("boost");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>();
  const { ask, dialog } = useSettingsConfirm();
  const { changes, name } = useSettingsChanges();
  const saving = useRef(false);
  const latest = useRef<Snapshot | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const read = beginSettingsRead();
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active && read.isCurrent()) {
          latest.current = value;
          setSnapshot(value);
          setMode(modeFromSetting(value.settings.keywordMode?.globalValue));
        }
      })
      .catch(() => {
        if (active) setStatus({ kind: "load-failed" });
      });
    const unsubscribe = onSettingsSnapshot((value) => {
      if (!active) return;
      const previous = latest.current;
      const next = value as Snapshot;
      latest.current = next;
      setSnapshot(next);
      // Keep a mode the user changed when another card reloads the shared snapshot.
      setMode((current) =>
        !previous || current === modeFromSetting(previous.settings.keywordMode?.globalValue)
          ? modeFromSetting(next.settings.keywordMode?.globalValue)
          : current
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const saved = modeFromSetting(snapshot?.settings.keywordMode?.globalValue);
  const overridden = snapshot?.settings.keywordMode?.source === "project";
  const reranker = snapshot ? rerankerOverridesMode(snapshot.settings) : false;

  const readOnly = snapshot?.readOnly === true;
  // The same words the dropdown shows, in the language of the page.
  const modeName = (value: unknown) => {
    const label = KEYWORD_MODE_OPTIONS.find((option) => option.value === value)?.label;
    return label ? t(label) : String(value);
  };
  const fields = [{ key: "keywordMode", label: name("keywordMode"), print: modeName }];
  /** Asks first; the choice stays in the dropdown until the dialog closes. */
  function save() {
    if (!snapshot || saving.current) return;
    const edits = keywordModeSaveEdits(mode);
    ask({
      title: s("Save keyword matching?"),
      body: <SettingsChangeList changes={changes({ keywordMode: saved }, edits, fields)} />,
      confirmLabel: s("Save"),
      busyLabel: s("Saving…"),
      run: () => commit(edits),
    });
  }
  async function commit(edits: { keywordMode: KeywordMode }): Promise<ConfirmResult> {
    if (!snapshot || saving.current) return { success: false };
    saving.current = true;
    setBusy(true);
    let ok = false;
    let stale = false;
    let failure: string | undefined;
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
      ok = true;
    } catch (error) {
      failure = (error as Error)?.message ?? "";
      stale = failure.includes("Config changed") === true;
    }
    const reloaded = (await reloadSettingsSnapshot<Snapshot>()) !== null;
    setBusy(false);
    saving.current = false;
    setStatus(stale ? { kind: "save", ok, reloaded, stale } : { kind: "save", ok, reloaded });
    return ok ? { success: true } : { success: false, error: s(failure ?? "") };
  }

  function statusText(current: Status): string {
    if (current.kind === "load-failed")
      return s("The keyword matching setting could not be loaded. Reload the page to try again.");
    const note = current.reloaded
      ? s("Current settings were reloaded; check the values and save again.")
      : s("The current settings could not be reloaded. Reload the page.");
    if (current.stale) return withNote(s("Config changed. Reload settings and save again."), note);
    return current.ok
      ? s("Saved. New searches use this mode.")
      : withNote(
          s("The keyword matching setting could not be saved. Reload the page to try again."),
          note
        );
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Keyword matching")}
    >
      <h2 className="text-section-title font-semibold">{s("Keyword matching")}</h2>
      <p className="text-xs text-muted-foreground">
        {s("Search finds memories by meaning and by exact words from your prompt.")}
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <SettingRow setting="keywordMode" controlId="keyword-mode" projectNote={overridden}>
          <Select
            id="keyword-mode"
            className="w-full"
            value={mode}
            disabled={busy}
            onChange={(event) => {
              if (isKeywordMode(event.target.value)) setMode(event.target.value);
            }}
          >
            {KEYWORD_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </Select>
        </SettingRow>
        <p className="text-xs text-muted-foreground">
          {mode === "rrf"
            ? t(PLAIN_TEXT.keywordMergeHelp)
            : t(
                "A memory that has a word from your prompt gets a small bonus in the order of the results."
              )}
        </p>
        {reranker && mode === "rrf" && (
          <p className="text-xs text-status-warning">{t(PLAIN_TEXT.keywordMergeWithReranker)}</p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !snapshot || readOnly || mode === saved}>
            {s("Save")}
          </Button>
          <ReadOnlyNote show={readOnly} />
          <Button
            type="button"
            variant="outline"
            disabled={busy || mode === saved}
            onClick={() => setMode(saved)}
          >
            {s("Cancel")}
          </Button>
        </div>
      </form>
      {status && (
        <p role="status" className="text-sm">
          {statusText(status)}
        </p>
      )}
      {dialog}
    </section>
  );
}
