import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  SettingsRequestError,
  settingsRequest,
  withNote,
} from "$lib/settings-api";
import { KeySourceField, type SavedKey } from "$lib/components/settings/KeySourceField";
import { SettingRow } from "$lib/components/settings/SettingRow";
import {
  SettingsConfirmDialog,
  type ConfirmResult,
} from "$lib/components/settings/SettingsConfirmDialog";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Switch } from "$lib/components/ui/switch";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { useSettingsText } from "$lib/i18n/settings";
import { useCatalogueText } from "$lib/i18n/settings-catalogue";
import {
  canSaveReranker,
  isRemoteRerankerUrl,
  keyChanged,
  keyDraftFromSecret,
  keyReference,
  parseRerankerTimeout,
  RERANKER_KEY_FILE,
  RERANKER_TIMEOUT_DEFAULT,
  rerankerFieldProblem,
  rerankerKeyBody,
  rerankerSaveEdits,
  type RerankerDraft,
  type RerankerSecret,
} from "$lib/reranker-controls";
import { rerankerMessage } from "$lib/reranker-messages";
import { ReadOnlyNote } from "../settings/ReadOnlyNote";

type Setting = { value?: unknown; source: string; globalValue?: unknown };
type Snapshot = {
  readOnly?: boolean;
  revision: string;
  settings: Record<string, Setting>;
  secrets: Record<string, RerankerSecret & { resolvesInWebApp?: boolean }>;
};

type RerankerStatus =
  | { kind: "load-failed" }
  | { kind: "save"; ok: boolean; reloaded: boolean; stale?: boolean; message?: string }
  | { kind: "testing" }
  | { kind: "test"; ok: boolean; code?: string; message?: string };

function draftFromSnapshot(snapshot: Snapshot | undefined): RerankerDraft {
  const settings = snapshot?.settings;
  return {
    enabled: settings?.rerankerEnabled?.value === true,
    url: typeof settings?.rerankerApiUrl?.value === "string" ? settings.rerankerApiUrl.value : "",
    model: typeof settings?.rerankerModel?.value === "string" ? settings.rerankerModel.value : "",
    timeout:
      typeof settings?.rerankerTimeoutMs?.value === "number"
        ? String(settings.rerankerTimeoutMs.value)
        : "4000",
    ...keyDraftFromSecret(snapshot?.secrets?.rerankerApiKey),
  };
}

/** Configure the opt-in reranker: switch, connection fields, timeout, Test. */
export function RerankerSection() {
  const s = useSettingsText();
  const t = useCatalogueText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<RerankerDraft>(draftFromSnapshot(undefined));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<RerankerStatus>();
  const [replacing, setReplacing] = useState(false);
  const { ask, dialog } = useSettingsConfirm();
  const { changes, name } = useSettingsChanges();
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

  const secret = snapshot?.secrets?.rerankerApiKey;
  const problem = rerankerFieldProblem(draft, secret);
  const canSave = canSaveReranker(draft, secret);
  const canTest = canSave && draft.url.trim().length > 0 && draft.model.trim().length > 0;
  const remote = draft.url.trim().length > 0 && isRemoteRerankerUrl(draft.url);
  const savedKey: SavedKey = secret?.set
    ? {
        source: secret.source as "env" | "file" | "literal" | null,
        reference: secret.reference,
        resolvesInWebApp: secret.resolvesInWebApp !== false,
      }
    : null;

  const readOnly = snapshot?.readOnly === true;
  function update(patch: Partial<RerankerDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
  }

  async function testServer() {
    if (busy || saving.current || !canTest) return;
    saving.current = true;
    setBusy(true);
    setStatus({ kind: "testing" });
    let result: RerankerStatus;
    try {
      // The pasted key goes in this request only. Nothing is saved by a test.
      const reference = keyReference(draft);
      const response = await settingsRequest<{ success: boolean; code?: string }>(
        "/api/settings/reranker/test",
        {
          method: "POST",
          body: JSON.stringify({
            rerankerApiUrl: draft.url.trim(),
            rerankerModel: draft.model.trim(),
            ...(reference ? { rerankerApiKey: reference } : {}),
            ...(draft.keyChoice === "paste" && draft.keyInput.value.trim()
              ? { rerankerApiKeyValue: draft.keyInput.value }
              : {}),
            rerankerTimeoutMs: parseRerankerTimeout(draft.timeout) ?? 4000,
          }),
        }
      );
      result = { kind: "test", ok: response.success === true, code: response.code };
    } catch (error) {
      // A refused request carries its own reason; any other failure is an unreachable server.
      result =
        error instanceof SettingsRequestError && (error.status === 400 || error.status === 403)
          ? { kind: "test", ok: false, message: error.message }
          : { kind: "test", ok: false, code: "reranker_unreachable" };
    }
    setBusy(false);
    saving.current = false;
    setStatus(result);
  }

  /** The saved key in words the dialog can show: its source and where it lives, never the key. */
  function savedKeyWord(): string {
    const saved = keyDraftFromSecret(secret);
    if (saved.keyChoice === "env") return `${t("Environment variable")} ${saved.keyInput.name}`;
    if (saved.keyChoice === "file") return `${t("Key file")} ${saved.keyInput.path}`;
    return t("No key");
  }

  /**
   * The typed key in words: where it will live, never the key itself. A pasted key goes to a
   * private file, so it reads as a key file with the name that file will have.
   */
  function typedKeyWord(): string {
    if (draft.keyChoice === "env")
      return `${t("Environment variable")} ${draft.keyInput.name.trim()}`;
    if (draft.keyChoice === "file") return `${t("Key file")} ${draft.keyInput.path.trim()}`;
    if (draft.keyChoice === "paste")
      return `${t("Key file")} ${draft.keyInput.name.trim() || RERANKER_KEY_FILE}`;
    return t("No key");
  }

  /** Asks first; the typed values stay in the form until the dialog closes. */
  function save() {
    if (!snapshot || !canSave || saving.current) return;
    const edits = rerankerSaveEdits(draft, secret);
    // The key goes through its own route; the list still names the change, in words.
    const listEdits: Record<string, unknown> = { ...edits };
    if (draft.keyChoice !== "none" && keyChanged(draft, secret))
      listEdits.rerankerApiKey = typedKeyWord();
    const savedDraft = draftFromSnapshot(snapshot);
    const inForce: Record<string, unknown> = {
      rerankerEnabled: savedDraft.enabled,
      rerankerApiUrl: savedDraft.url.trim() || null,
      rerankerModel: savedDraft.model.trim() || null,
      rerankerTimeoutMs: parseRerankerTimeout(savedDraft.timeout) ?? RERANKER_TIMEOUT_DEFAULT,
      rerankerApiKey: savedKeyWord(),
    };
    const textOrNull = (value: unknown) => (value == null ? t("Not set") : String(value));
    const fields = [
      { key: "rerankerEnabled", label: name("rerankerEnabled") },
      { key: "rerankerApiUrl", label: name("rerankerApiUrl"), print: textOrNull },
      { key: "rerankerModel", label: name("rerankerModel"), print: textOrNull },
      // The key's values are already words, so the row prints them as they are.
      { key: "rerankerApiKey", label: name("rerankerApiKey"), default: t("No key") },
      {
        key: "rerankerTimeoutMs",
        label: name("rerankerTimeoutMs"),
        default: RERANKER_TIMEOUT_DEFAULT,
        print: (value: unknown) => `${String(value)} ${s("milliseconds")}`,
      },
    ];
    const rows = changes(inForce, listEdits, fields);
    // Save stays on when nothing changed. The dialog has nothing to list for that, so the card
    // saves as it did before it asked first.
    if (rows.length === 0) {
      void persist();
      return;
    }
    ask({
      title: s("Save the reranker settings?"),
      body: <SettingsChangeList changes={rows} />,
      confirmLabel: s("Save"),
      busyLabel: s("Saving…"),
      run: async () => {
        const result = await persist();
        // The server asked whether to replace the key file: that dialog takes over
        // from this one, and nothing else is sent until the user decides.
        return result.error === undefined ? { success: true } : result;
      },
    });
  }

  /** Save the key first (it can need a confirm), then the other settings with the new revision. */
  async function persist(replace = false): Promise<ConfirmResult> {
    if (!snapshot || !canSave || saving.current) return { success: false };
    saving.current = true;
    setBusy(true);
    let revision = snapshot.revision;
    let keySaved = false;
    let failure: string | undefined;
    try {
      if (draft.keyChoice !== "none" && keyChanged(draft, secret)) {
        const key = rerankerKeyBody(draft, replace);
        if ("error" in key) throw new Error(key.error);
        const reply = await settingsRequest<{ revision?: string }>(
          "/api/settings/external-api/key",
          {
            method: "POST",
            body: JSON.stringify({ ...key.body, setting: "rerankerApiKey", revision }),
          }
        );
        revision = reply.revision ?? revision;
        keySaved = true;
      }
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits: rerankerSaveEdits(draft, secret), revision }),
      });
    } catch (error) {
      failure = (error as Error)?.message ?? "";
    }
    if (failure?.includes("Confirm to replace") && draft.keyChoice === "paste" && !replace) {
      // A key file with this name exists: nothing was written. Ask before replacing it.
      setBusy(false);
      saving.current = false;
      setReplacing(true);
      return { success: false };
    }
    const reloaded = await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
    saving.current = false;
    if (failure === undefined) {
      if (reloaded) setDraft(draftFromSnapshot(reloaded));
      else update({ keyInput: { ...draft.keyInput, value: "" } });
      setStatus({ kind: "save", ok: true, reloaded: reloaded !== null });
      return { success: true };
    }
    // The key file is already saved: show it as saved, so the next Save does not ask again.
    if (keySaved && reloaded) update(keyDraftFromSecret(reloaded.secrets?.rerankerApiKey));
    const stale = failure.includes("Config changed");
    setStatus({
      kind: "save",
      ok: false,
      reloaded: reloaded !== null,
      ...(stale ? { stale } : keySaved ? {} : { message: failure }),
    });
    return { success: false, error: s(failure) };
  }

  function statusNode(current: RerankerStatus): ReactNode {
    if (current.kind === "load-failed")
      return s("The reranker settings could not be loaded. Reload the page to try again.");
    if (current.kind === "testing") return t("Testing the reranker…");
    if (current.kind === "test") {
      if (current.ok) return s("Test passed.");
      if (current.message) return `${s("Test failed:")} ${s(current.message)}`;
      const { message, code } = rerankerMessage(current.code);
      return (
        <>
          {s("Test failed:")} {t(message)}
          {code ? (
            <>
              {" "}
              <code dir="ltr" className="text-xs text-muted-foreground">
                {code}
              </code>
            </>
          ) : null}
        </>
      );
    }
    const note = current.reloaded
      ? s("Current settings were reloaded; check the values and save again.")
      : s("The current settings could not be reloaded. Reload the page.");
    if (current.stale) return withNote(s("Config changed. Reload settings and save again."), note);
    if (current.ok) return s("Saved. New searches use these settings.");
    return withNote(
      s(
        current.message ?? "The reranker settings could not be saved. Reload the page to try again."
      ),
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
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <SettingRow setting="rerankerEnabled" controlId="reranker-enabled">
          <Switch
            id="reranker-enabled"
            checked={draft.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => update({ enabled })}
          />
        </SettingRow>
        <SettingRow setting="rerankerApiUrl" controlId="reranker-url">
          <Input
            type="url"
            id="reranker-url"
            dir="ltr"
            placeholder="http://127.0.0.1:3008/v1"
            disabled={busy}
            value={draft.url}
            aria-invalid={problem?.field === "url-model" || problem?.field === "url" || undefined}
            aria-describedby="reranker-url-help"
            onChange={(event) => update({ url: event.target.value })}
          />
          <span id="reranker-url-help" className="block text-xs text-muted-foreground">
            {problem?.field === "url-model"
              ? s("Enter the server URL and model before turning the reranker on.")
              : problem?.field === "url"
                ? t("Enter a web address that starts with http:// or https://.")
                : null}
          </span>
          {remote && (
            <p className="text-xs text-status-warning">
              {s("This URL is not on this machine: memory text leaves this machine.")}
            </p>
          )}
        </SettingRow>
        <SettingRow setting="rerankerModel" controlId="reranker-model">
          <Input
            type="text"
            id="reranker-model"
            dir="ltr"
            disabled={busy}
            value={draft.model}
            aria-invalid={problem?.field === "url-model" || undefined}
            onChange={(event) => update({ model: event.target.value })}
          />
        </SettingRow>
        <SettingRow setting="rerankerApiKey" controlId="reranker-key-source">
          <KeySourceField
            id="reranker-key"
            optional
            choice={draft.keyChoice}
            onChoice={(keyChoice) => update({ keyChoice })}
            input={draft.keyInput}
            onInput={(keyInput) => update({ keyInput })}
            saved={savedKey}
            disabled={busy}
            nameHint="reranker"
          />
          {problem?.field === "key" && problem.message ? (
            <p className="text-xs text-destructive">{s(problem.message)}</p>
          ) : null}
        </SettingRow>
        <SettingRow setting="rerankerTimeoutMs" controlId="reranker-timeout">
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
              "OpenCode waits up to 5 seconds for memories before it sends your prompt. The default, 4000 milliseconds, finishes in time. Over 5000, OpenCode can send your prompt without memories."
            )}
          </p>
        </SettingRow>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={busy || !snapshot || readOnly || !canSave}
            onClick={() => void save()}
          >
            {s("Save")}
          </Button>
          <ReadOnlyNote show={readOnly} />
          <Button
            type="button"
            variant="outline"
            disabled={busy || !canTest}
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
          {statusNode(status)}
        </p>
      )}
      {replacing && (
        <SettingsConfirmDialog
          title={t("Replace the key file?")}
          body={<p>{s("A key file with this name exists. Replace it?")}</p>}
          confirmLabel={t("Replace")}
          onConfirm={() => persist(true)}
          onClose={() => setReplacing(false)}
        />
      )}
      {dialog}
    </section>
  );
}
