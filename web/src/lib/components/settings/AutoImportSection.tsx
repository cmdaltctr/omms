import { useEffect, useState } from "react";
import {
  backfillModelEdit,
  manualModelFieldVisible,
  shouldPollBackfill,
  type BackfillHost,
} from "$lib/auto-import-settings";
import { onSettingsSnapshot, reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";

type Snapshot = { revision: string; settings: Record<string, { globalValue?: unknown }> };
type ModelList = {
  available: boolean;
  models?: Array<{ provider: string; model: string; name: string }>;
};
type Status = {
  state: string;
  model: string | null;
  cutoff: number;
  counts: {
    imported: number;
    skipped: number;
    failed: number;
    pending: number;
    unresolved: number;
  };
  error: string | null;
} | null;
type Rows = Record<BackfillHost, Status>;

export function AutoImportSection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [rows, setRows] = useState<Rows>({ pi: null, opencode: null });
  const [lists, setLists] = useState<Record<string, ModelList>>({});
  const [choices, setChoices] = useState<Partial<Record<BackfillHost, string>>>({});
  const [typedModes, setTypedModes] = useState<Partial<Record<BackfillHost, boolean>>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const polling = shouldPollBackfill(rows);
  useEffect(() => {
    let active = true;
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    void settingsRequest<Rows>("/api/settings/backfill")
      .then((value) => {
        if (active) setRows(value);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    for (const host of ["pi", "opencode"] as const) {
      void settingsRequest<ModelList>(`/api/settings/models?host=${host}`)
        .then((value) => {
          if (active) setLists((previous) => ({ ...previous, [host]: value }));
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

  useEffect(() => {
    if (!polling) return;
    let active = true;
    const timer = setInterval(() => {
      void settingsRequest<Rows>("/api/settings/backfill")
        .then((value) => {
          if (active) setRows(value);
        })
        .catch((error: Error) => {
          if (active) setMessage(error.message);
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [polling]);

  async function save(edits: Record<string, unknown>) {
    if (!snapshot) return;
    setBusy(true);
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
      setMessage(s("Saved. Changes apply at the next host start."));
    } catch (error) {
      setMessage((error as Error).message);
    }
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
  }
  function saveModel(host: BackfillHost, choice: string) {
    try {
      void save(backfillModelEdit(host, choice.trim()));
    } catch (error) {
      setMessage(s((error as Error).message));
    }
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Automatic import")}
    >
      <h2 className="text-lg font-medium">{s("Automatic import")}</h2>
      <p className="text-sm text-muted-foreground">
        {s(
          "Automatic import makes model calls. Changes apply at the next host start. Turning it off stops a running import after the current exchange."
        )}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(snapshot?.settings.autoBackfill?.globalValue)}
          disabled={busy || !snapshot}
          onChange={(event) => void save({ autoBackfill: event.target.checked })}
        />
        {s("Import past chats automatically")}
      </label>
      {(["pi", "opencode"] as const).map((host) => {
        const saved = String(snapshot?.settings[`${host}BackfillModel`]?.globalValue ?? "inherit");
        const current = choices[host] ?? saved;
        const options = lists[host]?.models ?? [];
        const known =
          current === "inherit" ||
          options.some((item) => `${item.provider}/${item.model}` === current);
        const typed = manualModelFieldVisible(typedModes[host], known);
        return (
          <div key={host} className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <h3 className="font-medium">{host === "pi" ? "Pi" : "OpenCode"}</h3>
            <label className="block">
              {s("Backfill model")}
              <select
                className="mt-1 block w-full rounded border border-border bg-background p-2"
                value={typed ? "typed" : current}
                onChange={(event) => {
                  const value = event.target.value;
                  setTypedModes((previous) => ({ ...previous, [host]: value === "typed" }));
                  setChoices((previous) => ({ ...previous, [host]: value }));
                }}
              >
                <option value="inherit">{s("Same as live capture")}</option>
                {options.map((item) => (
                  <option
                    key={`${item.provider}/${item.model}`}
                    value={`${item.provider}/${item.model}`}
                  >
                    {item.name} ({item.provider}/{item.model})
                  </option>
                ))}
                <option value="typed">{s("Manual provider/model")}</option>
              </select>
            </label>
            {typed && (
              <input
                aria-label={`${host} ${s("Manual provider/model")}`}
                className="w-full rounded border border-border bg-background p-2"
                placeholder="provider/model"
                value={current === "typed" ? "" : current}
                onChange={(event) =>
                  setChoices((previous) => ({ ...previous, [host]: event.target.value }))
                }
              />
            )}
            {lists[host]?.available === false && (
              <p>{s("Model list unavailable. Enter provider/model manually.")}</p>
            )}
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5"
              disabled={busy || !snapshot}
              onClick={() => saveModel(host, current)}
            >
              {s("Save model")}
            </button>
            <p>
              {s("State")}: {s(rows[host]?.state ?? "not started")}
            </p>
            {rows[host] && (
              <div className="space-y-1 text-muted-foreground">
                <p>
                  {s("Imported")}: {rows[host].counts.imported} · {s("Skipped")}:{" "}
                  {rows[host].counts.skipped} · {s("Failed")}: {rows[host].counts.failed}
                </p>
                <p>
                  {s("Pending")}: {rows[host].counts.pending} · {s("Unresolved sessions")}:{" "}
                  {rows[host].counts.unresolved}
                </p>
                <p>
                  {s("Model")}: {rows[host].model ?? s("none")}
                </p>
                <p>
                  {s("Cutoff")}: {new Date(rows[host].cutoff).toLocaleString()}
                </p>
                {rows[host].error && <p role="alert">{rows[host].error}</p>}
              </div>
            )}
          </div>
        );
      })}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
