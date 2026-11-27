import { useState } from "react";
import { Loader } from "lucide-react";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { useSettingsSnapshot } from "@/hooks/useSettingsSnapshot";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { Select } from "$lib/components/ui/select";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import { useCardText } from "$lib/i18n/settings-cards";
import { saveSettingEdits } from "$lib/settings-save";
import { SettingRow } from "./SettingRow";

type Setting = { value?: unknown; source?: string; globalValue?: unknown };
type Snapshot = {
  revision: string;
  /** True while the global file cannot be read: every Save is off. */
  readOnly?: boolean;
  settings: Record<string, Setting | undefined>;
};

const SWITCHES = ["autoCaptureEnabled", "chatMessage.enabled", "visibleRecall", "injectProfile"];
const SCOPE = "memory.defaultScope";

/** The main memory switches. They write the global config; a project file may still decide one. */
export function MemoryBasicsSection() {
  const t = useCardText();
  const { snapshot, error: loadError } = useSettingsSnapshot<Snapshot>();
  const { ask, dialog } = useSettingsConfirm();
  const { changes, name } = useSettingsChanges();
  const [edits, setEdits] = useState<Record<string, boolean | string>>({});
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const saved = (key: string) =>
    snapshot?.settings[key]?.globalValue ?? (key === SCOPE ? "project" : true);
  const value = (key: string) => edits[key] ?? saved(key);
  const changed = Object.keys(edits).filter((key) => edits[key] !== saved(key));
  const readOnly = snapshot?.readOnly === true;
  const projectDecides = (key: string) => snapshot?.settings[key]?.source === "project";
  const scopeName = (code: unknown) =>
    t(
      code === "all-projects" ? "All projects" : code === "project" ? "This project" : String(code)
    );
  const fields = [
    ...SWITCHES.map((key) => ({ key, label: name(key) })),
    { key: SCOPE, label: name(SCOPE), print: scopeName },
  ];

  function edit(key: string, next: boolean | string) {
    setEdits((previous) => ({ ...previous, [key]: next }));
    setMessage("");
  }

  /** Asks first, with each changed setting and its new value. The card's own feedback stays. */
  function save() {
    if (!snapshot || changed.length === 0) return;
    const body = Object.fromEntries(changed.map((key) => [key, edits[key]]));
    const inForce = Object.fromEntries([...SWITCHES, SCOPE].map((key) => [key, saved(key)]));
    ask({
      title: t("Save memory basics?"),
      body: <SettingsChangeList changes={changes(inForce, body, fields)} />,
      confirmLabel: t("Save"),
      busyLabel: t("Saving…"),
      run: async () => {
        setBusy(true);
        setMessage("");
        const result = await saveSettingEdits(snapshot.revision, body);
        setBusy(false);
        setFailed(!result.success);
        if (result.success) {
          setEdits({});
          setMessage(t("Saved."));
        } else {
          setMessage(result.error ?? "");
        }
        return result;
      },
    });
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={t("Memory basics")}
    >
      <h2 className="text-section-title font-semibold">{t("Memory basics")}</h2>
      <p className="text-sm text-muted-foreground">
        {t(
          "The main switches for saving and recalling memories. They apply to OpenCode, Pi and Claude Code."
        )}
      </p>
      {loadError ? <p role="alert">{loadError}</p> : null}
      <div className="space-y-4">
        {SWITCHES.map((key) => (
          <SettingRow
            key={key}
            setting={key}
            controlId={`basics-${key}`}
            projectNote={projectDecides(key)}
          >
            <Checkbox
              id={`basics-${key}`}
              checked={value(key) === true}
              disabled={busy || !snapshot}
              onCheckedChange={(checked) => edit(key, checked === true)}
            />
          </SettingRow>
        ))}
        <SettingRow
          setting={SCOPE}
          controlId={`basics-${SCOPE}`}
          projectNote={projectDecides(SCOPE)}
        >
          <Select
            id={`basics-${SCOPE}`}
            aria-label={t("Where a search looks")}
            value={String(value(SCOPE))}
            disabled={busy || !snapshot}
            onChange={(event) => edit(SCOPE, event.target.value)}
          >
            <option value="project">{t("This project")}</option>
            <option value="all-projects">{t("All projects")}</option>
          </Select>
        </SettingRow>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={busy || !snapshot || readOnly || changed.length === 0}
          onClick={() => void save()}
        >
          {t("Save")}
        </Button>
        {readOnly ? (
          <p className="text-xs text-muted-foreground">
            {t("Saving is turned off until the file is fixed.")}
          </p>
        ) : null}
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t("Saving…")}
          </p>
        ) : null}
        {message ? (
          <p role={failed ? "alert" : "status"} className="text-sm">
            {message}
          </p>
        ) : null}
      </div>
      {dialog}
    </section>
  );
}
