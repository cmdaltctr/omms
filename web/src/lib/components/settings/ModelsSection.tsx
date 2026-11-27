import { useEffect, useState } from "react";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Select } from "$lib/components/ui/select";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import type { ConfirmResult } from "$lib/components/settings/SettingsConfirmDialog";
import { SettingRow } from "./SettingRow";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withNote,
} from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { useCardText } from "$lib/i18n/settings-cards";
import { externalMissing, hostModelEdit } from "$lib/external-api-settings";
import { hostLabel } from "$lib/host-label";
import { fill } from "$lib/skills-model";
import { ClaudeCaptureStatus, type ClaudeCaptureState } from "./ClaudeCaptureStatus";
import { ReadOnlyNote } from "./ReadOnlyNote";

type Setting = { value?: string; globalValue?: string; source: string };
type Snapshot = {
  readOnly?: boolean;
  revision: string;
  settings: Record<string, Setting>;
  fallback: { model: string | null; configured: boolean };
  effective: {
    opencode: { mode?: string; ready: boolean };
    pi: { kind: string };
    "claude-code"?: ClaudeCaptureState;
  };
  secrets: Record<string, { set: boolean; source: string | null }>;
};
type Model = { provider: string; model: string; name: string };
type ModelList = { available: boolean; models?: Model[]; reason?: string };

export function ModelsSection() {
  const s = useSettingsText();
  const t = useCardText();
  const { ask, dialog } = useSettingsConfirm();
  const { changes, name } = useSettingsChanges();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [lists, setLists] = useState<Record<string, ModelList>>({});
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
    for (const host of ["opencode", "pi"]) {
      void settingsRequest<ModelList>(`/api/settings/models?host=${host}`)
        .then((list) => {
          if (active) setLists((previous) => ({ ...previous, [host]: list }));
        })
        .catch(() => {
          if (active) setLists((previous) => ({ ...previous, [host]: { available: false } }));
        });
    }
    const unsubscribe = onSettingsSnapshot((value) => {
      if (active) setSnapshot(value as Snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const readOnly = snapshot?.readOnly === true;
  /** A model value in plain words: the two special choices have names, the rest is provider/model. */
  const modelText = (value: unknown) =>
    value === "inherit"
      ? s("Session model")
      : value === "external"
        ? s("External API")
        : value == null
          ? s("Not set")
          : String(value);
  /** Asks first, with each setting the model choice changes. The card's own feedback stays. */
  function save(host: string, choice: string) {
    if (!snapshot) return;
    let edits: Record<string, string>;
    try {
      edits = hostModelEdit(host as "opencode" | "pi", choice);
    } catch (error) {
      setMessage(s((error as Error).message));
      return;
    }
    const providerKey = `${host}Provider`;
    const modelKey = `${host}Model`;
    const fields = [
      { key: providerKey, label: name(providerKey) },
      { key: modelKey, label: name(modelKey), print: modelText },
    ];
    const inForce = {
      [providerKey]: snapshot.settings[providerKey]?.globalValue,
      [modelKey]: snapshot.settings[modelKey]?.globalValue,
    };
    const rows = changes(inForce, edits, fields);
    // Save stays on for an unchanged choice. The dialog has nothing to list for that, so the card
    // saves as it did before it asked first.
    if (rows.length === 0) {
      void saveChoice(edits);
      return;
    }
    ask({
      title: fill(s("Save the {host} model?"), { host: hostLabel(host as "opencode" | "pi") }),
      body: <SettingsChangeList changes={rows} />,
      confirmLabel: s("Save model"),
      busyLabel: s("Saving…"),
      run: () => saveChoice(edits),
    });
  }
  /** Saves the choice. A refusal keeps the dialog open with its reason. */
  async function saveChoice(edits: Record<string, string>): Promise<ConfirmResult> {
    if (!snapshot) return { success: false };
    setBusy(true);
    let result: { migratedLegacy: boolean } | undefined;
    let failure: Error | undefined;
    try {
      result = await settingsRequest<{ migratedLegacy: boolean }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
    } catch (error) {
      failure = error as Error;
    }
    // Publish only settings that were actually reloaded, never the pre-save copy.
    const reloaded = (await reloadSettingsSnapshot<Snapshot>()) !== null;
    setBusy(false);
    if (result) {
      const saved = s(
        result.migratedLegacy
          ? "Saved. OMMS now reads ~/.config/omms/omms.jsonc. The legacy config was kept."
          : "Saved. New capture and profile work uses these settings."
      );
      setMessage(reloaded ? saved : `${saved} ${s("Reload the page before saving again.")}`);
    } else {
      setMessage(
        withNote(
          failure?.message ?? "",
          reloaded
            ? s("Current settings were reloaded; check the values and save again.")
            : s("The current settings could not be reloaded. Reload the page.")
        )
      );
    }
    return result ? { success: true } : { success: false, error: failure?.message ?? "" };
  }

  const missing = externalMissing({
    memoryProvider: snapshot?.settings.memoryProvider?.globalValue,
    memoryModel: snapshot?.settings.memoryModel?.globalValue,
    memoryApiUrl: snapshot?.settings.memoryApiUrl?.globalValue,
    keySet: Boolean(snapshot?.secrets.memoryApiKey?.set),
  });
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Models")}
    >
      <h2 className="text-section-title font-semibold">{s("Models")}</h2>
      <p className="text-sm text-muted-foreground">
        {snapshot?.fallback.configured
          ? t(
              "When OpenCode or Pi has no model of its own, OMMS uses the external API model {model}.",
              {
                model: snapshot.fallback.model ?? t("its own default"),
              }
            )
          : t(
              "The external API is not set up, so when OpenCode or Pi has no model of its own, OMMS uses the session model."
            )}
      </p>
      {(["opencode", "pi"] as const).map((host) => (
        <ModelCard
          key={host}
          host={host}
          model={snapshot?.settings[`${host}Model`]}
          provider={snapshot?.settings[`${host}Provider`]}
          effective={
            host === "pi"
              ? snapshot?.effective.pi.kind
              : (snapshot?.effective.opencode.mode ?? "unready")
          }
          list={lists[host]}
          externalMissing={missing}
          busy={busy || !snapshot || readOnly}
          onSave={(choice) => save(host, choice)}
        />
      ))}
      <ReadOnlyNote show={readOnly} />
      <ClaudeCaptureStatus status={snapshot?.effective["claude-code"]} />
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {dialog}
    </section>
  );
}

export function ModelCard({
  host,
  model,
  provider,
  effective,
  list,
  externalMissing,
  busy,
  onSave,
}: {
  host: "opencode" | "pi";
  model?: Setting;
  provider?: Setting;
  effective?: string;
  list?: ModelList;
  externalMissing: string[];
  busy: boolean;
  onSave: (choice: string) => void;
}) {
  const s = useSettingsText();
  const selected =
    model?.globalValue === "inherit" || !model?.globalValue
      ? "inherit"
      : model.globalValue === "external"
        ? "external"
        : `${provider?.globalValue ?? ""}/${model.globalValue}`;
  const [choice, setChoice] = useState<"inherit" | "manual" | "external">();
  const [manual, setManual] = useState<string>();
  const [picked, setPicked] = useState<string>();
  const current =
    choice ?? (selected === "inherit" || selected === "external" ? selected : "manual");
  const options = list?.models ?? [];
  const savedModel = selected === "inherit" || selected === "external" ? "" : selected;
  const selectedModel =
    picked || savedModel || (options[0] ? `${options[0].provider}/${options[0].model}` : "typed");
  const useTyped = !options.some((entry) => `${entry.provider}/${entry.model}` === selectedModel);
  const typed = manual ?? savedModel;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <h3 className="text-subsection-title font-semibold">{hostLabel(host)}</h3>
      <p className="text-xs text-muted-foreground">
        {s("Effective model")}:{" "}
        {model?.value === "external" && effective === "manual"
          ? s("external API")
          : model?.value === "inherit" || effective === "session"
            ? s("session")
            : effective === "manual"
              ? s("external API")
              : effective === "unready"
                ? s("unavailable")
                : `${provider?.value ?? ""}/${model?.value ?? ""}`}
      </p>
      {(model?.source === "project" || provider?.source === "project") && (
        <p className="text-xs text-amber-600">
          {s("Project override is active. Changes to the global file may not take effect here.")}
        </p>
      )}
      <SettingRow setting={`${host}Model`} controlId={`${host}-model`}>
        <Select
          id={`${host}-model`}
          aria-label={s("Model choice")}
          value={current}
          onChange={(event) => setChoice(event.target.value as "inherit" | "manual" | "external")}
        >
          <option value="inherit">{s("Session model")}</option>
          <option value="manual">{s("Manual model")}</option>
          <option value="external" disabled={externalMissing.length > 0}>
            {s("External API")}
          </option>
        </Select>
      </SettingRow>
      {externalMissing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {s("External API needs")}: {externalMissing.join(", ")}
        </p>
      )}
      {current === "manual" && list?.available && options.length > 0 && (
        <Select
          className="w-full rounded-lg border border-border bg-background p-2 text-sm"
          aria-label={`${hostLabel(host)} ${s("Model")}`}
          value={useTyped ? "typed" : selectedModel}
          onChange={(event) => setPicked(event.target.value)}
        >
          {options.map((entry) => (
            <option
              value={`${entry.provider}/${entry.model}`}
              key={`${entry.provider}/${entry.model}`}
            >
              {entry.name} ({entry.provider}/{entry.model})
            </option>
          ))}
          <option value="typed">{s("Manual provider/model")}</option>
        </Select>
      )}
      {current === "manual" && useTyped && (
        <Input
          className="w-full rounded-lg border border-border bg-background p-2 text-sm"
          aria-label={`${host} ${s("Manual provider/model")}`}
          placeholder="provider/model"
          value={typed}
          onChange={(event) => {
            setManual(event.target.value);
            setPicked("typed");
          }}
        />
      )}
      {current === "manual" && list && !list.available && (
        <p className="text-xs text-muted-foreground">
          {list.reason
            ? s(list.reason)
            : s("Model list unavailable. Enter provider/model manually.")}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() =>
          onSave(current !== "manual" ? current : useTyped ? typed.trim() : selectedModel)
        }
      >
        {s("Save model")}
      </Button>
    </div>
  );
}
