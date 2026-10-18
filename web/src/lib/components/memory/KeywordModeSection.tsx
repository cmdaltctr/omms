import { useEffect, useRef, useState } from "react";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withNote,
} from "$lib/settings-api";
import { Button } from "$lib/components/ui/button";
import { Label } from "$lib/components/ui/label";
import { Select } from "$lib/components/ui/select";
import { useSettingsText } from "$lib/i18n/settings";
import {
  KEYWORD_MODE_OPTIONS,
  isKeywordMode,
  keywordModeSaveEdits,
  modeFromSetting,
  rerankerOverridesMode,
  type KeywordMode,
} from "$lib/keyword-mode-controls";

type Setting = { value?: unknown; source: string; globalValue?: unknown };
type Snapshot = { revision: string; settings: Record<string, Setting> };
type Status =
  { kind: "load-failed" } | { kind: "save"; ok: boolean; reloaded: boolean; stale?: boolean };

/** Choose how word matches join the search results. Rank fusion is experimental. */
export function KeywordModeSection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [mode, setMode] = useState<KeywordMode>("boost");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>();
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

  async function save() {
    if (!snapshot || saving.current) return;
    saving.current = true;
    setBusy(true);
    let ok = false;
    let stale = false;
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits: keywordModeSaveEdits(mode), revision: snapshot.revision }),
      });
      ok = true;
    } catch (error) {
      stale = (error as Error)?.message?.includes("Config changed") === true;
    }
    const reloaded = (await reloadSettingsSnapshot<Snapshot>()) !== null;
    setBusy(false);
    saving.current = false;
    setStatus(stale ? { kind: "save", ok, reloaded, stale } : { kind: "save", ok, reloaded });
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
        <div className="space-y-2">
          <Label htmlFor="keyword-mode">{s("Word matching mode")}</Label>
          {/* The list is as wide as this wrapper (and grows with its longest option). */}
          <div className="w-72 max-w-full">
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
                  {s(option.label)}
                </option>
              ))}
            </Select>
          </div>
          <span id="keyword-mode-help" className="block text-xs text-muted-foreground">
            keywordMode
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {s(
            mode === "rrf"
              ? "Rank fusion merges a list by meaning and a list by words. A memory that contains a word of your prompt can be returned even when its meaning score is below the similarity threshold. Experimental: it has not been shown to find more relevant memories."
              : "Boost adds a small score bonus to memories that contain a word of your prompt."
          )}
        </p>
        {reranker && mode === "rrf" && (
          <p className="text-xs text-amber-600">
            {s("Rank fusion is not used while the reranker is on. Search uses the boost.")}
          </p>
        )}
        {overridden && (
          <p className="text-xs text-muted-foreground">
            {s("A project file can override this setting. This page edits the global value.")}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !snapshot || mode === saved}>
            {s("Save")}
          </Button>
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
    </section>
  );
}
