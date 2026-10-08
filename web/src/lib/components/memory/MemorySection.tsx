import { useEffect, useRef, useState } from "react";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withNote,
} from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import {
  canSaveMemory,
  classifyMemorySaveFailure,
  formatMemoryDefault,
  MEMORY_CONTROLS,
  memoryInputValue,
  memorySaveEdits,
  parseMemoryValue,
  STALE_CONFIG_MESSAGE,
  type MemorySaveFailure,
} from "$lib/memory-controls";
import { tableWrap, td, th, thead, tr } from "../settings/table-styles";

type Setting = { value?: unknown; source: string; globalValue?: unknown; default?: unknown };
type Snapshot = { revision: string; settings: Record<string, Setting> };

/** Store status identities so a language switch retranslates the feedback. */
type MemoryStatus =
  | { kind: "load-failed" }
  | { kind: "saved"; reloaded: boolean }
  | { kind: "save-failed"; failure: MemorySaveFailure; reloaded: boolean };

/** Edit global limits only; project overrides stay in force. */
export function MemorySection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<MemoryStatus>();
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
  async function save() {
    if (!snapshot || !canSave || saving.current) return;
    const edits = memorySaveEdits(draft, loaded);
    if (!Object.keys(edits).length) return;
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
      setDraft({});
      setStatus({ kind: "saved", reloaded });
    } else
      setStatus({
        kind: "save-failed",
        failure: classifyMemorySaveFailure(failure?.message ?? ""),
        reloaded,
      });
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
      <p className="text-xs text-muted-foreground">{s("Byte limits count UTF-8 bytes.")}</p>
      <p className="text-xs text-muted-foreground">
        {s(
          "Approximate tokens are estimated as ceil(UTF-8 bytes / 4). A provider can count more or fewer tokens for the same text."
        )}
      </p>
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
                const value = memoryInputValue(control, draft, loaded);
                const invalid =
                  typeof raw === "string" && parseMemoryValue(control, raw) === undefined;
                const setting = snapshot?.settings[control.key];
                const overridden = setting?.source === "project";
                return (
                  <tr className={tr} key={control.key}>
                    <td className={td}>
                      <code dir="ltr">{control.key}</code>
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
                      <input
                        type="number"
                        id={`${control.id}-input`}
                        className="w-36 tabular-nums"
                        inputMode="numeric"
                        step={1}
                        min={control.min}
                        max={control.max}
                        aria-label={`${control.key} ${s("Value")}`}
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
                    </td>
                    <td className={`${td} tabular-nums`}>
                      {formatMemoryDefault(defaults[control.key])}
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
          <button
            type="submit"
            disabled={busy || !snapshot || !canSave}
            onClick={() => void save()}
          >
            {s("Save memory limits")}
          </button>
          <button type="button" disabled={busy} onClick={() => setDraft({})}>
            {s("Cancel")}
          </button>
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
