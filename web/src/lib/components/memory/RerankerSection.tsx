import { useEffect, useRef, useState } from "react";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withNote,
} from "$lib/settings-api";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
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
  // The latest shared snapshot, so a refresh can tell untouched fields from typed ones.
  const latestSnapshot = useRef<Snapshot | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const read = beginSettingsRead();
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active && read.isCurrent()) {
          latestSnapshot.current = value;
          setSnapshot(value);
          setDraft(draftFromSnapshot(value));
        }
      })
      .catch(() => {
        if (active) setStatus({ kind: "load-failed" });
      });
    const unsubscribe = onSettingsSnapshot((value) => {
      if (!active) return;
      const previous = latestSnapshot.current;
      const next = value as Snapshot;
      latestSnapshot.current = next;
      setSnapshot(next);
      // Keep typed values when another card reloads the shared snapshot.
      setDraft((current) =>
        !previous || JSON.stringify(current) === JSON.stringify(draftFromSnapshot(previous))
          ? draftFromSnapshot(next)
          : current
      );
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
        {s("A project file cannot change these settings. The reranker settings are global only.")}
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
          <Label htmlFor="reranker-enabled">{s("Use a reranker")}</Label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="reranker-url">{s("Server URL")}</Label>
            <Input
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
          <div className="space-y-2">
            <Label htmlFor="reranker-model">{s("Model")}</Label>
            <Input
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
          <div className="space-y-2">
            <Label htmlFor="reranker-key">{s("Key")}</Label>
            <Input
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
          <div className="space-y-2">
            <Label htmlFor="reranker-timeout">{s("Timeout")}</Label>
            <Input
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
          <Button
            type="submit"
            disabled={busy || !snapshot || !canSave}
            onClick={() => void save()}
          >
            {s("Save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !canSave}
            onClick={() => void testServer()}
          >
            {s("Test")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setDraft(draftFromSnapshot(snapshot))}
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
