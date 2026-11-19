import { useEffect, useRef, useState } from "react";
import { Loader } from "lucide-react";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withNote,
} from "$lib/settings-api";
import { Button } from "$lib/components/ui/button";
import { SettingRow } from "$lib/components/settings/SettingRow";
import {
  SettingsConfirmDialog,
  type ConfirmResult,
} from "$lib/components/settings/SettingsConfirmDialog";
import { Select } from "$lib/components/ui/select";
import { useSettingsText } from "$lib/i18n/settings";
import {
  PROFILE_LEARNING_CONTROLS,
  PROFILE_LEARNING_FIXED_ROWS,
  hasSavedLearningKey,
  learningFromSettings,
  learningResetEdits,
  learningSaveEdits,
  type LearningDraft,
  type ProfileLearningKey,
} from "$lib/profile-learning-controls";
import { ReadOnlyNote } from "../settings/ReadOnlyNote";

type Setting = { source?: string; globalValue?: unknown; hasGlobal?: boolean };
type Snapshot = { readOnly?: boolean; revision: string; settings: Record<string, Setting> };
type Status =
  | { kind: "load-failed" }
  | { kind: "save"; ok: boolean; reloaded: boolean; stale?: boolean }
  | { kind: "reset-done" };
type Outcome = { ok: boolean; stale?: boolean; reloaded: boolean };

/** A row with no dropdown: the same layout as a setting row, with the fixed value as text. */
function FixedRow({ name, description, value }: (typeof PROFILE_LEARNING_FIXED_ROWS)[number]) {
  const s = useSettingsText();
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 space-y-1 sm:max-w-[60%]">
        <p className="text-ui font-medium">{s(name)}</p>
        <p className="text-xs text-muted-foreground">{s(description)}</p>
        <p className="text-xs text-muted-foreground">
          {s("Default")}: <bdi>{s(value)}</bdi>
          {" · "}
          {s("Fixed. This is not a setting.")}
        </p>
      </div>
      <p className="min-w-0 text-sm sm:w-72 sm:max-w-full">
        <bdi>{s(value)}</bdi>
      </p>
    </div>
  );
}

/**
 * The Profile learning settings table: six dropdowns and four fixed rows. Save writes only the
 * changed keys to the global config; Reset to default removes all six keys after a confirmation.
 * The dropdowns hold only what the user changed, so a reload of the snapshot never loses a choice.
 */
export function ProfileLearningSettingsSection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<Partial<LearningDraft>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [resetting, setResetting] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    const read = beginSettingsRead();
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active && read.isCurrent()) setSnapshot(value);
      })
      .catch(() => {
        if (active) setStatus({ kind: "load-failed" });
      });
    const unsubscribe = onSettingsSnapshot((value) => {
      if (active) setSnapshot(value as Snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const saved = learningFromSettings(snapshot?.settings);
  const shown = { ...saved, ...draft };
  const edits = learningSaveEdits(draft, saved);
  const changed = Object.keys(edits).length > 0;
  const readOnly = snapshot?.readOnly === true;
  const canReset = hasSavedLearningKey(snapshot?.settings) && !busy && !readOnly;

  /** One PATCH with the revision this section last saw, then a reload so every card agrees. */
  async function send(body: Record<string, unknown>): Promise<Outcome & { reason?: string }> {
    let ok = false;
    let stale = false;
    let reason: string | undefined;
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits: body, revision: snapshot?.revision }),
      });
      ok = true;
    } catch (error) {
      reason = (error as Error)?.message;
      stale = reason?.includes("Config changed") === true;
    }
    const reloaded = (await reloadSettingsSnapshot<Snapshot>()) !== null;
    return { ok, stale, reloaded, reason };
  }

  async function save() {
    if (!snapshot || saving.current || !changed) return;
    saving.current = true;
    setBusy(true);
    const { ok, stale, reloaded } = await send(edits);
    if (ok) setDraft({});
    setBusy(false);
    saving.current = false;
    setStatus(stale ? { kind: "save", ok, reloaded, stale } : { kind: "save", ok, reloaded });
  }

  async function reset(): Promise<ConfirmResult> {
    if (!snapshot || saving.current) return { success: false };
    saving.current = true;
    setBusy(true);
    const { ok, stale, reloaded } = await send(learningResetEdits());
    setBusy(false);
    saving.current = false;
    if (ok) {
      setDraft({});
      setStatus({ kind: "reset-done" });
      return { success: true };
    }
    return { success: false, error: failureText({ ok, stale, reloaded }, "reset") };
  }

  function failureText(outcome: Outcome, action: "save" | "reset"): string {
    const note = outcome.reloaded
      ? s("Current settings were reloaded; check the values and save again.")
      : s("The current settings could not be reloaded. Reload the page.");
    if (outcome.stale) return withNote(s("Config changed. Reload settings and save again."), note);
    return withNote(
      s(
        action === "save"
          ? "The learning settings could not be saved. Reload the page to try again."
          : "The learning settings could not be reset. Reload the page to try again."
      ),
      note
    );
  }

  function statusText(current: Status): string {
    if (current.kind === "load-failed")
      return s("The learning settings could not be loaded. Reload the page to try again.");
    if (current.kind === "reset-done") return s("Reset. Every row shows its default.");
    return current.ok
      ? s("Saved. The next learning pass uses these settings.")
      : failureText(current, "save");
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={s("Learning settings")}
    >
      <h2 className="text-section-title font-semibold">{s("Learning settings")}</h2>
      <p className="text-xs text-muted-foreground">
        {s("These settings apply to every host. They are saved in the global config file.")}
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {PROFILE_LEARNING_CONTROLS.map((control) => (
          <SettingRow key={control.key} setting={control.key} controlId={control.controlId}>
            <Select
              id={control.controlId}
              className="w-full"
              wrapLabel
              value={String(shown[control.key])}
              disabled={busy}
              onChange={(event) => {
                const option = control.options.find(
                  (entry) => String(entry.value) === event.target.value
                );
                if (option)
                  setDraft((current: Partial<LearningDraft>) => ({
                    ...current,
                    [control.key as ProfileLearningKey]: option.value,
                  }));
              }}
            >
              {control.options.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {s(option.label)}
                </option>
              ))}
            </Select>
          </SettingRow>
        ))}
        {PROFILE_LEARNING_FIXED_ROWS.map((row) => (
          <FixedRow key={row.name} {...row} />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy || !snapshot || readOnly || !changed}>
            {s("Save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !changed}
            onClick={() => setDraft({})}
          >
            {s("Cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canReset}
            onClick={() => setResetting(true)}
          >
            {s("Reset to default")}
          </Button>
          <ReadOnlyNote show={readOnly} />
        </div>
      </form>
      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {s("Saving…")}
        </p>
      )}
      {status && !busy && (
        <p role="status" className="text-sm">
          {statusText(status)}
        </p>
      )}
      {resetting && (
        <SettingsConfirmDialog
          title={s("Reset the learning settings?")}
          body={
            <p>
              {s(
                "This removes the six learning settings from the global config file. Every row goes back to its default."
              )}
            </p>
          }
          confirmLabel={s("Reset to default")}
          onConfirm={reset}
          onClose={() => setResetting(false)}
        />
      )}
    </section>
  );
}
