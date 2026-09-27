import { useEffect, useState } from "react";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withNote,
} from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";

type Setting = { value?: string; globalValue?: string; source: string };
type Snapshot = {
  revision: string;
  settings: Record<string, Setting>;
  fallback: { model: string | null; configured: boolean };
  effective: { opencode: { mode?: string; ready: boolean }; pi: { kind: string } };
  secrets: Record<string, { set: boolean; source: string | null }>;
};
type Model = { provider: string; model: string; name: string };
type ModelList = { available: boolean; models?: Model[]; reason?: string };

export function ModelsSection() {
  const s = useSettingsText();
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

  async function save(host: string, choice: string) {
    if (!snapshot) return;
    const providerKey = `${host}Provider`;
    const modelKey = `${host}Model`;
    const slash = choice.indexOf("/");
    if (choice !== "inherit" && (slash < 1 || slash === choice.length - 1)) {
      setMessage(s("Enter a model as provider/model."));
      return;
    }
    const edits =
      choice === "inherit"
        ? { [modelKey]: "inherit" }
        : { [providerKey]: choice.slice(0, slash), [modelKey]: choice.slice(slash + 1) };
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
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Models")}
    >
      <h2 className="text-lg font-medium">{s("Models")}</h2>
      <p className="text-sm text-muted-foreground">
        {s("External API fallback")}: {snapshot?.fallback.model ?? s("none")} (
        {s(snapshot?.fallback.configured ? "ready" : "not ready")}).
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
          busy={busy || !snapshot}
          onSave={(choice) => save(host, choice)}
        />
      ))}
      <div className="text-xs text-muted-foreground">
        {s("Credentials (values hidden)")}:{" "}
        {snapshot &&
          Object.entries(snapshot.secrets).map(([key, secret]) => (
            <span className="me-3" key={key}>
              {key}: {secret.set ? `${s("set")} (${secret.source})` : s("not set")}
            </span>
          ))}
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}

function ModelCard({
  host,
  model,
  provider,
  effective,
  list,
  busy,
  onSave,
}: {
  host: string;
  model?: Setting;
  provider?: Setting;
  effective?: string;
  list?: ModelList;
  busy: boolean;
  onSave: (choice: string) => void;
}) {
  const s = useSettingsText();
  const selected =
    model?.globalValue === "inherit" || !model?.globalValue
      ? "inherit"
      : `${provider?.globalValue ?? ""}/${model.globalValue}`;
  const [choice, setChoice] = useState<"inherit" | "manual">();
  const [manual, setManual] = useState<string>();
  const [picked, setPicked] = useState<string>();
  const current = choice ?? (selected === "inherit" ? "inherit" : "manual");
  const options = list?.models ?? [];
  const savedModel = selected === "inherit" ? "" : selected;
  const selectedModel =
    picked || savedModel || (options[0] ? `${options[0].provider}/${options[0].model}` : "typed");
  const useTyped = !options.some((entry) => `${entry.provider}/${entry.model}` === selectedModel);
  const typed = manual ?? savedModel;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <h3 className="font-medium">{host === "pi" ? "Pi" : "OpenCode"}</h3>
      <p className="text-xs text-muted-foreground">
        {s("Effective model")}:{" "}
        {model?.value === "inherit" || effective === "session"
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
      <label className="block text-sm" htmlFor={`${host}-model`}>
        {s("Model choice")}
      </label>
      <select
        id={`${host}-model`}
        className="w-full rounded-lg border border-border bg-background p-2 text-sm"
        value={current}
        onChange={(event) => setChoice(event.target.value as "inherit" | "manual")}
      >
        <option value="inherit">{s("Session model")}</option>
        <option value="manual">{s("Manual model")}</option>
      </select>
      {current === "manual" && list?.available && options.length > 0 && (
        <select
          className="w-full rounded-lg border border-border bg-background p-2 text-sm"
          aria-label={`${host === "pi" ? "Pi" : "OpenCode"} ${s("Model")}`}
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
        </select>
      )}
      {current === "manual" && useTyped && (
        <input
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
          {s("Model list unavailable. Enter provider/model manually.")}
        </p>
      )}
      <button
        type="button"
        className="rounded-lg border border-border px-3 py-1.5 text-sm"
        disabled={busy}
        onClick={() =>
          onSave(current === "inherit" ? "inherit" : useTyped ? typed.trim() : selectedModel)
        }
      >
        {s("Save model")}
      </button>
    </div>
  );
}
