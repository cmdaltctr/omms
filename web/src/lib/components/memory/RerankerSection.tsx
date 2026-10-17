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
  canSaveReranker,
  isRemoteRerankerUrl,
  parseRerankerTimeout,
  rerankerFieldProblem,
  rerankerSaveEdits,
  type RerankerDraft,
} from "$lib/reranker-controls";

type Setting = { value?: unknown; source: string; globalValue?: unknown };
type Snapshot = {
  revision: string;
  settings: Record<string, Setting>;
  secrets: Record<string, { set: boolean; source: string | null; reference: string | null }>;
};

type RerankerStatus =
  | { kind: "load-failed" }
  | { kind: "save"; ok: boolean; reloaded: boolean; stale?: boolean }
  | { kind: "test"; ok: boolean; code?: string };

function draftFromSnapshot(snapshot: Snapshot | undefined): RerankerDraft {
  const settings = snapshot?.settings;
  const keyReference = snapshot?.secrets.rerankerApiKey?.reference;
  return {
    enabled: settings?.rerankerEnabled?.value === true,
    url: typeof settings?.rerankerApiUrl?.value === "string" ? settings.rerankerApiUrl.value : "",
    model: typeof settings?.rerankerModel?.value === "string" ? settings.rerankerModel.value : "",
    key: snapshot?.secrets.rerankerApiKey?.set
      ? `${snapshot.secrets.rerankerApiKey.source}://${keyReference ?? ""}`
      : "",
    timeout:
      typeof settings?.rerankerTimeoutMs?.value === "number"
        ? String(settings.rerankerTimeoutMs.value)
        : "4000",
  };
}

/** Configure the opt-in reranker: switch, connection fields, timeout, Test. */
export function RerankerSection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<RerankerDraft>({
    enabled: false,
    url: "",
    model: "",
    key: "",
    timeout: "4000",
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<RerankerStatus>();
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    const read = beginSettingsRead();
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active && read.isCurrent()) {
          setSnapshot(value);
          setDraft(draftFromSnapshot(value));
        }
      })
      .catch(() => {
        if (active) setStatus({ kind: "load-failed" });
      });
    const unsubscribe = onSettingsSnapshot((value) => {
      if (active) {
        setSnapshot(value as Snapshot);
        setDraft(draftFromSnapshot(value as Snapshot));
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const problem = rerankerFieldProblem(draft);
  const canSave = canSaveReranker(draft);
  const remote = draft.url.trim().length > 0 && isRemoteRerankerUrl(draft.url);

  function update(patch: Partial<RerankerDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
  }

  async function testServer() {
    if (busy || saving.current || !canSave) return;
    saving.current = true;
    setBusy(true);
    let ok = false;
    let code: string | undefined;
    try {
      const response = await settingsRequest<{ success: boolean; code?: string }>(
        "/api/settings/reranker/test",
        {
          method: "POST",
          body: JSON.stringify({
            rerankerApiUrl: draft.url.trim() || undefined,
            rerankerModel: draft.model.trim() || undefined,
            rerankerApiKey: draft.key.trim() || undefined,
            rerankerTimeoutMs: parseRerankerTimeout(draft.timeout) ?? 4000,
          }),
        }
      );
      ok = response.success === true;
      code = response.code;
    } catch {
      code = "reranker_unreachable";
    }
    setBusy(false);
    saving.current = false;
    setStatus({ kind: "test", ok, code });
  }

  async function save() {
    if (!snapshot || !canSave || saving.current) return;
    saving.current = true;
    setBusy(true);
    let saved = false;
    let stale = false;
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits: rerankerSaveEdits(draft), revision: snapshot.revision }),
      });
      saved = true;
    } catch (error) {
      stale = (error as Error)?.message?.includes("Config changed") === true;
    }
    const reloaded = (await reloadSettingsSnapshot<Snapshot>()) !== null;
    setBusy(false);
    saving.current = false;
    setStatus(
      stale ? { kind: "save", ok: saved, reloaded, stale } : { kind: "save", ok: saved, reloaded }
    );
  }

  function statusText(current: RerankerStatus): string {
    if (current.kind === "load-failed")
      return s("The reranker settings could not be loaded. Reload the page to try again.");
    if (current.kind === "test")
      return current.ok
        ? s("Test passed.")
        : `${s("Test failed:")} ${current.code ?? "reranker_unreachable"}`;
    const note = current.reloaded
      ? s("Current settings were reloaded; check the values and save again.")
      : s("The current settings could not be reloaded. Reload the page.");
    if (current.stale) return withNote(s("Config changed. Reload settings and save again."), note);
    return current.ok
      ? s("Saved. New searches use these settings.")
      : withNote(
          s("The reranker settings could not be saved. Reload the page to try again."),
          note
        );
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Reranker")}
    >
      <h2 className="text-section-title font-semibold">{s("Reranker")}</h2>
      <p className="text-xs text-muted-foreground">
        {s(
          "The reranker reorders the best memory search results with your reranker server and keeps the top results."
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {s(
          "The reranker sends the prompt and the text of candidate memories to the server URL. A server on the same machine is recommended."
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {s("A project file cannot change these settings.")}
      </p>
      {!draft.enabled && (
        <p className="text-xs text-muted-foreground">
          {s("Search is unchanged while the switch is off.")}
        </p>
      )}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="reranker-enabled"
            role="switch"
            checked={draft.enabled}
            disabled={busy}
            aria-label={s("Use a reranker")}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          <label htmlFor="reranker-enabled">{s("Use a reranker")}</label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="reranker-url">{s("Server URL")}</label>
            <input
              type="url"
              id="reranker-url"
              dir="ltr"
              placeholder="http://127.0.0.1:3008/v1"
              disabled={busy}
              value={draft.url}
              aria-invalid={problem?.field === "url-model" || undefined}
              aria-describedby="reranker-url-help"
              onChange={(event) => update({ url: event.target.value })}
            />
            <span id="reranker-url-help" className="block text-xs text-muted-foreground">
              {problem?.field === "url-model"
                ? s("Enter the server URL and model before turning the reranker on.")
                : "rerankerApiUrl"}
            </span>
            {remote && (
              <p className="text-xs text-amber-600">
                {s("This URL is not on this machine: memory text leaves this machine.")}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="reranker-model">{s("Model")}</label>
            <input
              type="text"
              id="reranker-model"
              dir="ltr"
              disabled={busy}
              value={draft.model}
              aria-invalid={problem?.field === "url-model" || undefined}
              onChange={(event) => update({ model: event.target.value })}
            />
            <span className="block text-xs text-muted-foreground">rerankerModel</span>
          </div>
          <div>
            <label htmlFor="reranker-key">{s("Key")}</label>
            <input
              type="text"
              id="reranker-key"
              dir="ltr"
              disabled={busy}
              value={draft.key}
              aria-invalid={problem?.field === "key" || undefined}
              aria-describedby="reranker-key-help"
              onChange={(event) => update({ key: event.target.value })}
            />
            <span id="reranker-key-help" className="block text-xs text-muted-foreground">
              {problem?.field === "key"
                ? s("The key must be an env:// or file:// reference, or left empty.")
                : s("Optional env:// or file:// key reference.")}
            </span>
          </div>
          <div>
            <label htmlFor="reranker-timeout">{s("Timeout")}</label>
            <input
              type="number"
              id="reranker-timeout"
              className="tabular-nums"
              inputMode="numeric"
              step={1}
              min={500}
              max={30000}
              disabled={busy}
              value={draft.timeout}
              aria-invalid={problem?.field === "timeout" || undefined}
              aria-describedby="reranker-timeout-help"
              onChange={(event) => update({ timeout: event.target.value })}
            />
            <span id="reranker-timeout-help" className="block text-xs text-muted-foreground">
              {problem?.field === "timeout"
                ? s("Enter a whole number from 500 to 30,000.")
                : s("milliseconds")}
            </span>
            <p className="text-xs text-muted-foreground">
              {s(
                "The default of 4000 keeps the search inside OpenCode V2's 5-second wait. A value over 5000 can make OpenCode V2 send the request with no memory."
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || !snapshot || !canSave}
            onClick={() => void save()}
          >
            {s("Save")}
          </button>
          <button type="button" disabled={busy || !canSave} onClick={() => void testServer()}>
            {s("Test")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setDraft(draftFromSnapshot(snapshot))}
          >
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
