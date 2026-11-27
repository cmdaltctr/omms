import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { Tooltip } from "$lib/components/ui/tooltip";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
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
  | { kind: "save"; ok: boolean; reloaded: boolean; stale?: boolean; reason?: string }
  | { kind: "reset-done" };
type Outcome = { ok: boolean; stale?: boolean; reloaded: boolean; reason?: string };

/**
 * The snapshot as the server confirmed it after a save or reset: a value is now in the global
 * file, and null means the key was removed. Used when the reload that follows fails, so the
 * dropdowns keep showing what the server accepted.
 */
function withConfirmed(snapshot: Snapshot, edits: Record<string, unknown>): Snapshot {
  const settings = { ...snapshot.settings };
  for (const [key, value] of Object.entries(edits)) {
    settings[key] =
      value === null
        ? { ...settings[key], source: "default", hasGlobal: false, globalValue: undefined }
        : { ...settings[key], source: "global", hasGlobal: true, globalValue: value };
  }
  return { ...snapshot, settings };
}

/** The confirmed edits over `current` only while no newer snapshot replaced `start`. */
function confirmedOver(
  current: Snapshot | undefined,
  start: Snapshot | undefined,
  edits: Record<string, unknown>
): Snapshot | undefined {
  return current && current === start ? withConfirmed(current, edits) : current;
}

/**
 * A turned-off button keeps its place and says why. A disabled button gets no hover or focus, so
 * it sits in a focusable span that shows the reason as a tooltip; an sr-only line carries the
 * same reason for the button's aria-describedby (the pattern of SpaceActionButton).
 */
function WithReason({
  reason,
  id,
  children,
}: {
  reason?: string;
  id: string;
  children: ReactNode;
}) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip content={reason}>
      <span
        tabIndex={0}
        className="inline-flex rounded-[9px] focus-visible:outline-2 focus-visible:outline-ring"
      >
        {children}
        <span id={id} className="sr-only">
          {reason}
        </span>
      </span>
    </Tooltip>
  );
}

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
  const { ask, dialog } = useSettingsConfirm();
  const { changes, name } = useSettingsChanges();
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
  const hasSaved = hasSavedLearningKey(snapshot?.settings);
  const canReset = hasSaved && !busy && !readOnly;
  // The first cause that turns a button off, in words. Undefined while the button works.
  const waitReason = s("Wait until the current save finishes.");
  const readOnlyReason = s("Saving is turned off until the file is fixed.");
  const saveReason = busy
    ? waitReason
    : !snapshot
      ? s("The settings have not loaded yet.")
      : readOnly
        ? readOnlyReason
        : !changed
          ? s("Change a setting to turn on Save.")
          : undefined;
  const cancelReason = busy
    ? waitReason
    : !changed
      ? s("There are no unsaved changes to cancel.")
      : undefined;
  const resetReason = busy
    ? waitReason
    : readOnly
      ? readOnlyReason
      : !hasSaved
        ? s(
            "No learning setting is saved in the global config file, so every row shows its default."
          )
        : undefined;

  /** One PATCH with the revision this section last saw, then a reload so every card agrees. */
  async function send(body: Record<string, unknown>): Promise<Outcome> {
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

  /** Asks first; the choices stay in the dropdowns until the dialog closes. */
  function save() {
    if (!snapshot || saving.current || !changed) return;
    const fields = PROFILE_LEARNING_CONTROLS.map((control) => ({
      key: control.key,
      label: name(control.key),
      print: (value: unknown) => {
        const option = control.options.find((entry) => entry.value === value);
        return option ? s(option.label) : String(value);
      },
    }));
    ask({
      title: s("Save learning settings?"),
      body: <SettingsChangeList changes={changes(saved, edits, fields)} />,
      confirmLabel: s("Save"),
      busyLabel: s("Saving…"),
      run: commit,
    });
  }

  async function commit(): Promise<ConfirmResult> {
    if (!snapshot || saving.current || !changed) return { success: false };
    saving.current = true;
    setBusy(true);
    const start = snapshot;
    const { ok, stale, reloaded, reason } = await send(edits);
    if (ok) {
      setDraft({});
      if (!reloaded) setSnapshot((current) => confirmedOver(current, start, edits));
    }
    setBusy(false);
    saving.current = false;
    setStatus(
      stale ? { kind: "save", ok, reloaded, stale } : { kind: "save", ok, reloaded, reason }
    );
    return ok
      ? { success: true }
      : { success: false, error: failureText({ ok, stale, reloaded, reason }, "save") };
  }

  async function reset(): Promise<ConfirmResult> {
    if (!snapshot || saving.current) return { success: false };
    saving.current = true;
    setBusy(true);
    const start = snapshot;
    const outcome = await send(learningResetEdits());
    setBusy(false);
    saving.current = false;
    if (outcome.ok) {
      setDraft({});
      if (!outcome.reloaded) {
        setSnapshot((current) => confirmedOver(current, start, learningResetEdits()));
      }
      setStatus({ kind: "reset-done" });
      return { success: true };
    }
    return { success: false, error: failureText(outcome, "reset") };
  }

  function failureText(outcome: Outcome, action: "save" | "reset"): string {
    const note = outcome.reloaded
      ? s("Current settings were reloaded; check the values and save again.")
      : s("The current settings could not be reloaded. Reload the page.");
    if (outcome.stale) return withNote(s("Config changed. Reload settings and save again."), note);
    // A refused request carries its own reason; show it in place of the general sentence.
    return withNote(
      s(
        outcome.reason ||
          (action === "save"
            ? "The learning settings could not be saved. Reload the page to try again."
            : "The learning settings could not be reset. Reload the page to try again.")
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
          <WithReason reason={saveReason} id="profile-learning-save-reason">
            <Button
              type="submit"
              disabled={busy || !snapshot || readOnly || !changed}
              aria-describedby={saveReason ? "profile-learning-save-reason" : undefined}
            >
              {s("Save")}
            </Button>
          </WithReason>
          <WithReason reason={cancelReason} id="profile-learning-cancel-reason">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !changed}
              aria-describedby={cancelReason ? "profile-learning-cancel-reason" : undefined}
              onClick={() => setDraft({})}
            >
              {s("Cancel")}
            </Button>
          </WithReason>
          <WithReason reason={resetReason} id="profile-learning-reset-reason">
            <Button
              type="button"
              variant="outline"
              disabled={!canReset}
              aria-describedby={resetReason ? "profile-learning-reset-reason" : undefined}
              onClick={() => setResetting(true)}
            >
              {s("Reset to default")}
            </Button>
          </WithReason>
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
      {dialog}
    </section>
  );
}
