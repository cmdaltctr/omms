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
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import type { ConfirmResult } from "$lib/components/settings/SettingsConfirmDialog";
import { useSettingsText } from "$lib/i18n/settings";
import { useCatalogueText } from "$lib/i18n/settings-catalogue";
import { findCatalogueEntry, PLAIN_TEXT } from "$lib/settings-catalogue";
import {
  canSaveMemory,
  classifyMemorySaveFailure,
  formatMemoryDefault,
  MEMORY_CONTROLS,
  memoryInputValue,
  memorySaveEdits,
  parseMemoryValue,
  STALE_CONFIG_MESSAGE,
  type MemoryControlKey,
  type MemorySaveFailure,
} from "$lib/memory-controls";
import { tableWrap, td, th, thead, tr } from "../settings/table-styles";
import { ReadOnlyNote } from "../settings/ReadOnlyNote";

type Setting = {
  value?: unknown;
  source: string;
  globalValue?: unknown;
  default?: unknown;
  hasGlobal?: boolean;
};
type Snapshot = { readOnly?: boolean; revision: string; settings: Record<string, Setting> };

/** Store status identities so a language switch retranslates the feedback. */
type MemoryStatus =
  | { kind: "load-failed" }
  | { kind: "saved"; reloaded: boolean }
  | { kind: "save-failed"; failure: MemorySaveFailure; reloaded: boolean };

/** Edit global limits only; project overrides stay in force. */
export function MemorySection() {
  const s = useSettingsText();
  const t = useCatalogueText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<MemoryStatus>();
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

  const loaded: Record<string, number | undefined> = {};
  const defaults: Record<string, number> = {};
  for (const control of MEMORY_CONTROLS) {
    const entry = snapshot?.settings[control.key];
    loaded[control.key] = typeof entry?.globalValue === "number" ? entry.globalValue : undefined;
    defaults[control.key] = typeof entry?.default === "number" ? entry.default : control.default;
  }
  const canSave = canSaveMemory(draft, loaded);
  const configPath = "~/.config/omms/omms.jsonc";
  const configHelp = s(
    "Edit ~/.config/omms/omms.jsonc directly to set these limits without the web UI."
  ).split(configPath);
  const readOnly = snapshot?.readOnly === true;
  // The values in force, keyed as the request spells them, so the dialog lists the same
  // numbers the card compares a draft against.
  const inForce = Object.fromEntries(
    MEMORY_CONTROLS.map((control) => [control.key, loaded[control.key] ?? control.default])
  );
  const fields = MEMORY_CONTROLS.map((control) => ({
    key: control.key,
    label: name(control.key),
    default: control.default,
    print: (value: unknown) =>
      typeof value === "number" ? formatMemoryDefault(value) : String(value ?? ""),
  }));
  function save() {
    if (!snapshot || !canSave || saving.current) return;
    const edits = memorySaveEdits(draft, loaded);
    if (!Object.keys(edits).length) return;
    ask({
      title: s("Save memory limits?"),
      body: <SettingsChangeList changes={changes(inForce, edits, fields)} />,
      confirmLabel: s("Save memory limits"),
      busyLabel: s("Saving…"),
      run: () => saveEdits(edits),
    });
  }
  /** Reset one row: null on the wire removes the key so the default applies again. */
  function reset(key: MemoryControlKey) {
    if (!snapshot || busy || saving.current) return;
    if (!snapshot.settings[key]?.hasGlobal) return;
    ask({
      title: s("Reset to default?"),
      body: <SettingsChangeList changes={changes(inForce, { [key]: null }, fields)} />,
      confirmLabel: s("Reset to default"),
      busyLabel: s("Saving…"),
      run: () => saveEdits({ [key]: null }),
    });
  }
  async function saveEdits(edits: Record<string, unknown>): Promise<ConfirmResult> {
    if (!snapshot || saving.current) return { success: false };
    saving.current = true;
    setBusy(true);
    let saved = false;
    let failure: Error | undefined;
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
      saved = true;
    } catch (error) {
      failure = error as Error;
    }
    const reloaded = (await reloadSettingsSnapshot<Snapshot>()) !== null;
    setBusy(false);
    saving.current = false;
    if (saved) {
      setDraft((previous) => {
        const next = { ...previous };
        for (const key of Object.keys(edits)) delete next[key];
        return next;
      });
      setStatus({ kind: "saved", reloaded });
      return { success: true };
    }
    setStatus({
      kind: "save-failed",
      failure: classifyMemorySaveFailure(failure?.message ?? ""),
      reloaded,
    });
    return { success: false, error: s(failure?.message ?? "") };
  }
  function statusText(current: MemoryStatus): string {
    if (current.kind === "load-failed")
      return s("The memory settings could not be loaded. Reload the page to try again.");
    if (current.kind === "saved")
      return current.reloaded
        ? s("Saved. New memory operations use these limits.")
        : `${s("Saved. New memory operations use these limits.")} ${s("Reload the page before saving again.")}`;
    const note = current.reloaded
      ? s("Current settings were reloaded; check the values and save again.")
      : s("The current settings could not be reloaded. Reload the page.");
    if (current.failure.kind === "stale") return withNote(s(STALE_CONFIG_MESSAGE), note);
    if (current.failure.kind === "invalid") {
      const invalid = current.failure;
      const control = MEMORY_CONTROLS.find((entry) => entry.key === invalid.key)!;
      return withNote(`${s("Invalid setting")} ${control.key}: ${s(control.accepted)}`, note);
    }
    return withNote(s("The memory settings could not be saved."), note);
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Memory limits")}
    >
      <h2 className="text-section-title font-semibold">{s("Memory limits")}</h2>
      <p className="text-xs text-muted-foreground">{t(PLAIN_TEXT.bytesNote)}</p>
      <p className="text-xs text-muted-foreground">{t(PLAIN_TEXT.tokensNote)}</p>
      <p className="text-xs text-muted-foreground">
        {s(
          "These controls do not delete stored data, set a spending limit, limit model replies, or control Graphify output."
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {configHelp[0]}
        <code dir="ltr">{configPath}</code>
        {configHelp[1]}
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className={tableWrap}>
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">{s("Memory limits")}</caption>
            <thead className={thead}>
              <tr>
                {["Setting", "Value", "Default", "Unit", "Affects"].map((label) => (
                  <th key={label} className={th}>
                    {s(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MEMORY_CONTROLS.map((control) => {
                const raw = draft[control.key];
                const entry = findCatalogueEntry(control.key);
                const name = entry ? t(entry.name) : control.key;
                const value = memoryInputValue(control, draft, loaded);
                const invalid =
                  typeof raw === "string" && parseMemoryValue(control, raw) === undefined;
                const setting = snapshot?.settings[control.key];
                const overridden = setting?.source === "project";
                // Reset needs a key in the file; the marker needs a saved value
                // that differs from the (embedder-aware) default.
                const hasGlobal = setting?.hasGlobal === true;
                const differs =
                  hasGlobal &&
                  typeof setting?.globalValue === "number" &&
                  setting.globalValue !== defaults[control.key];
                return (
                  <tr className={tr} key={control.key}>
                    <td className={td}>
                      <Label htmlFor={`${control.id}-input`} className="font-medium">
                        {name}
                      </Label>
                      {entry && (
                        <p className="text-xs text-muted-foreground">{t(entry.description)}</p>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        <code dir="ltr">{control.key}</code>
                      </span>
                      {overridden && (
                        <div className="mt-1 space-y-0.5 text-xs text-amber-600">
                          <p>
                            {s("Effective value")}: {String(setting?.value ?? "")} ({s("project")})
                          </p>
                          <p>
                            {s(
                              "Project override is active. Changes to the global file may not take effect here."
                            )}
                          </p>
                          <p>
                            {s(
                              "The project value stays in force. Saving edits the global file only."
                            )}
                          </p>
                        </div>
                      )}
                    </td>
                    <td className={td}>
                      <Input
                        type="number"
                        id={`${control.id}-input`}
                        className="w-36 tabular-nums"
                        inputMode={control.kind === "decimal" ? "decimal" : "numeric"}
                        step={control.kind === "decimal" ? 0.01 : 1}
                        min={control.min}
                        max={control.max}
                        aria-label={`${name} ${s("Value")}`}
                        aria-describedby={`${control.id}-help`}
                        aria-invalid={invalid || undefined}
                        disabled={busy}
                        value={value}
                        onChange={(event) =>
                          setDraft((previous) => ({
                            ...previous,
                            [control.key]: event.target.value,
                          }))
                        }
                      />
                      <span
                        id={`${control.id}-help`}
                        className={`block text-xs ${invalid ? "text-red-600" : "text-muted-foreground"}`}
                      >
                        {s(control.accepted)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        data-reset={control.key}
                        className="mt-1"
                        disabled={busy || readOnly || !hasGlobal}
                        aria-label={`${name} ${s("Reset to default")}`}
                        onClick={() => void reset(control.key)}
                      >
                        {s("Reset to default")}
                      </Button>
                    </td>
                    <td className={`${td} tabular-nums`}>
                      {formatMemoryDefault(defaults[control.key])}
                      {differs && (
                        <span className="block text-xs text-amber-600">
                          {s("Differs from default")}
                        </span>
                      )}
                    </td>
                    <td className={td}>{s(control.unit)}</td>
                    <td className={td}>{s(control.affects)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={busy || !snapshot || readOnly || !canSave}
            onClick={() => void save()}
          >
            {s("Save memory limits")}
          </Button>
          <ReadOnlyNote show={readOnly} />
          <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft({})}>
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
