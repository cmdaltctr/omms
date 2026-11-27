import { useEffect, useState } from "react";
import { Loader, Lock, LockOpen } from "lucide-react";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Select } from "$lib/components/ui/select";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withBusy,
} from "$lib/settings-api";
import { useCardText } from "$lib/i18n/settings-cards";
import { SettingRow } from "./SettingRow";
import { KeySourceField, type KeyChoice } from "./KeySourceField";
import {
  EMBEDDING_PRESETS,
  canApply,
  candidateBody,
  candidateKey,
  confirmation,
  DEFAULT_BUILTIN_MODEL,
  keyChoiceFor,
  kindChange,
  presetUrl,
  type EmbeddingFields,
} from "$lib/embedding-settings";
import { ReadOnlyNote } from "./ReadOnlyNote";

export type EmbeddingRun = {
  state: "idle" | "running" | "done" | "failed";
  progress: { processed: number; total: number };
  error?: string;
};
export type CurrentEmbedding = {
  kind: "builtin" | "server";
  url: string | null;
  model: string;
  dimensions: number;
  memoryCount: number;
  run: EmbeddingRun;
};
type Snapshot = {
  readOnly?: boolean;
  revision: string;
  secrets: Record<string, { set: boolean } | undefined>;
};

/** The embedder in use, read-only, as the locked card shows it. */
export function EmbeddingSummary({
  current,
  keySet,
}: {
  current: CurrentEmbedding;
  keySet: boolean;
}) {
  const s = useCardText();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt>{s("Kind")}</dt>
      <dd>{s(current.kind === "server" ? "OpenAI-compatible server" : "Built-in model")}</dd>
      {current.url && (
        <>
          <dt>{s("Server URL")}</dt>
          <dd className="break-all">{current.url}</dd>
        </>
      )}
      <dt>{s("Model")}</dt>
      <dd className="break-all">{current.model}</dd>
      <dt>{s("Vector size")}</dt>
      <dd>{current.dimensions}</dd>
      <dt>{s("API key")}</dt>
      <dd>{s(keySet ? "set" : "not set")}</dd>
      <dt>{s("Stored memories")}</dt>
      <dd>{current.memoryCount.toLocaleString("en-US")}</dd>
    </dl>
  );
}

/** Re-embed progress, and the reason with a Retry button after a failure. */
export function EmbeddingRunStatus({ run, onRetry }: { run: EmbeddingRun; onRetry: () => void }) {
  const s = useCardText();
  if (run.state === "idle") return null;
  return (
    <div role="status" className="space-y-1 text-sm">
      {run.state === "running" && (
        <p>
          {s("Re-embedding")}: {run.progress.processed}/{run.progress.total}
        </p>
      )}
      {run.state === "done" && <p>{s("Re-embed finished.")}</p>}
      {run.state === "failed" && (
        <>
          <p className="text-red-600">
            {s("Re-embed failed")}: {run.error ?? ""}
          </p>
          <Button type="button" variant="outline" onClick={onRetry}>
            {s("Retry")}
          </Button>
        </>
      )}
    </div>
  );
}

function fieldsFrom(current: CurrentEmbedding, keySet: boolean): EmbeddingFields {
  return {
    kind: current.kind,
    url: current.url ?? "",
    model: current.model,
    key: keyChoiceFor(current.kind, keySet),
    keyInput: { name: "", path: "", value: "" },
  };
}

export function EmbeddingSection() {
  const s = useCardText();
  const { ask, dialog } = useSettingsConfirm();
  const [current, setCurrent] = useState<CurrentEmbedding>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [local, setLocal] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [fields, setFields] = useState<EmbeddingFields>();
  const [passed, setPassed] = useState<{ key: string; dimensions: number }>();
  const [run, setRun] = useState<EmbeddingRun>({
    state: "idle",
    progress: { processed: 0, total: 0 },
  });
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const readOnly = snapshot?.readOnly === true;
  async function loadCurrent() {
    const value = await settingsRequest<CurrentEmbedding>("/api/settings/embedding");
    setCurrent(value);
    setRun(value.run);
    return value;
  }

  useEffect(() => {
    let active = true;
    const read = beginSettingsRead();
    void loadCurrent().catch((error: Error) => active && setMessage(error.message));
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => active && read.isCurrent() && setSnapshot(value))
      .catch(() => {});
    void settingsRequest<{ isLocal?: boolean }>("/api/web/status")
      .then((status) => active && setLocal(Boolean(status.isLocal)))
      .catch(() => {});
    const unsubscribe = onSettingsSnapshot((value) => active && setSnapshot(value as Snapshot));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Poll while a re-embed runs; stop once it ends.
  useEffect(() => {
    if (run.state !== "running") return;
    const timer = setInterval(() => {
      void settingsRequest<EmbeddingRun>("/api/settings/embedding/run")
        .then((next) => {
          setRun(next);
          if (next.state !== "running") void loadCurrent();
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [run.state]);

  function report(ok: boolean, text: string) {
    setFailed(!ok);
    setMessage(text);
  }

  function toggleLock() {
    // Locking again, like Cancel, drops every unsaved edit.
    if (unlocked || !current) {
      setUnlocked(false);
      setFields(undefined);
      setPassed(undefined);
      return;
    }
    setFields(fieldsFrom(current, Boolean(snapshot?.secrets.embeddingApiKey?.set)));
    setUnlocked(true);
  }

  const edit = (change: Partial<EmbeddingFields>) =>
    setFields((previous) => (previous ? { ...previous, ...change } : previous));

  async function test() {
    if (!fields) return;
    await withBusy(setBusy, async () => {
      try {
        const result = await settingsRequest<{ ok: boolean; dimensions?: number; reason?: string }>(
          "/api/settings/embedding/test",
          { method: "POST", body: JSON.stringify(candidateBody(fields)) }
        );
        if (result.ok && result.dimensions) {
          setPassed({ key: candidateKey(fields), dimensions: result.dimensions });
          report(true, `${s("Test passed. Vector size")}: ${result.dimensions}`);
        } else {
          setPassed(undefined);
          report(false, `${s("Test failed")}: ${result.reason ?? ""}`);
        }
      } catch (error) {
        report(false, s((error as Error).message));
      }
    });
  }

  function apply() {
    if (!fields || !current || !snapshot) return;
    const { count, risks } = confirmation(current.memoryCount, fields);
    ask({
      title: s("Re-embed every memory?"),
      body: (
        <>
          <p>{`${s("Every stored memory will be re-embedded")}: ${count}`}</p>
          <ul className="list-disc ps-5">
            {risks.map((risk) => (
              <li key={risk}>{s(risk)}</li>
            ))}
          </ul>
        </>
      ),
      confirmLabel: s("Re-embed"),
      busyLabel: s("Re-embedding…"),
      destructive: true,
      run: async () => {
        try {
          const started = await settingsRequest<EmbeddingRun>("/api/settings/embedding/apply", {
            method: "POST",
            body: JSON.stringify({
              candidate: candidateBody(fields),
              revision: snapshot.revision,
            }),
          });
          setRun(started);
          setUnlocked(false);
          setFields(undefined);
          setPassed(undefined);
          setMessage("");
          await reloadSettingsSnapshot<Snapshot>();
          return { success: true };
        } catch (error) {
          await reloadSettingsSnapshot<Snapshot>();
          return { success: false, error: (error as Error).message };
        }
      },
    });
  }

  /** Asks first: a retry re-embeds every stored memory, which calls the embedding model again. */
  function retry() {
    ask({
      title: s("Retry the re-embed?"),
      body: (
        <p>
          {s("The re-embed will run again and send every stored memory to the embedding model.")}
        </p>
      ),
      confirmLabel: s("Retry"),
      busyLabel: s("Re-embedding…"),
      run: async () => {
        try {
          setRun(
            await settingsRequest<EmbeddingRun>("/api/settings/embedding/run", {
              method: "POST",
              body: "{}",
            })
          );
          return { success: true };
        } catch (error) {
          report(false, (error as Error).message);
          return { success: false, error: (error as Error).message };
        }
      },
    });
  }

  const saved = snapshot?.secrets.embeddingApiKey;
  const keySet = Boolean(saved?.set);
  const lockLabel = s(unlocked ? "Lock" : "Unlock to change");
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Embedding")}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-section-title font-semibold">{s("Embedding")}</h2>
        {local && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={lockLabel}
            title={lockLabel}
            disabled={!current || run.state === "running"}
            onClick={toggleLock}
          >
            {unlocked ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {s(
          "This model lets OMMS find memories by meaning. If you change it, OMMS must process every saved memory again before search works well."
        )}
      </p>
      {current && !unlocked && <EmbeddingSummary current={current} keySet={keySet} />}
      {unlocked && fields && (
        <div className="space-y-4 text-sm">
          <div className="space-y-1">
            <Label htmlFor="embedding-kind">{s("Kind")}</Label>
            <Select
              id="embedding-kind"
              aria-label={s("Kind")}
              value={fields.kind}
              onChange={(event) =>
                edit(
                  kindChange(
                    event.target.value as EmbeddingFields["kind"],
                    current?.kind === "builtin" ? current.model : DEFAULT_BUILTIN_MODEL
                  )
                )
              }
            >
              <option value="builtin">{s("Built-in model")}</option>
              <option value="server">{s("OpenAI-compatible server")}</option>
            </Select>
          </div>
          {fields.kind === "server" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="embedding-preset">{s("Preset")}</Label>
                <Select
                  id="embedding-preset"
                  aria-label={s("Preset")}
                  value={
                    EMBEDDING_PRESETS.find((preset) => preset.url === fields.url)?.id ?? "custom"
                  }
                  onChange={(event) => edit({ url: presetUrl(event.target.value, fields.url) })}
                >
                  {EMBEDDING_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.id === "custom" ? s("Custom") : preset.label}
                    </option>
                  ))}
                </Select>
              </div>
              <SettingRow setting="embeddingApiUrl" controlId="embedding-url">
                <Input
                  id="embedding-url"
                  dir="ltr"
                  value={fields.url}
                  onChange={(event) => edit({ url: event.target.value })}
                />
              </SettingRow>
            </>
          )}
          <SettingRow setting="embeddingModel" controlId="embedding-model">
            <Input
              id="embedding-model"
              dir="ltr"
              placeholder={
                fields.kind === "server" ? "nomic-embed-text" : "Xenova/nomic-embed-text-v1"
              }
              value={fields.model}
              onChange={(event) => edit({ model: event.target.value })}
            />
          </SettingRow>
          {fields.kind === "server" && (
            <SettingRow setting="embeddingApiKey" controlId="embedding-key-source">
              {fields.key === "saved" ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{s("The saved key is kept.")}</p>
                  <Button type="button" variant="outline" onClick={() => edit({ key: "file" })}>
                    {s("Replace the saved key")}
                  </Button>
                </div>
              ) : (
                <KeySourceField
                  id="embedding-key"
                  optional
                  choice={fields.key as KeyChoice}
                  onChoice={(choice) => edit({ key: choice })}
                  input={fields.keyInput}
                  onInput={(keyInput) => edit({ keyInput })}
                  nameHint="embedding-api"
                  saved={
                    saved?.set
                      ? {
                          source: (saved as { source?: "env" | "file" | "literal" }).source ?? null,
                          reference: (saved as { reference?: string }).reference ?? null,
                          resolvesInWebApp:
                            (saved as { resolvesInWebApp?: boolean }).resolvesInWebApp !== false,
                        }
                      : null
                  }
                />
              )}
            </SettingRow>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !fields.model.trim()}
              onClick={() => void test()}
            >
              {s("Test")}
            </Button>
            <Button
              type="button"
              disabled={busy || readOnly || !canApply(passed?.key, fields)}
              onClick={apply}
            >
              {s("Apply")}
            </Button>
            <Button type="button" variant="outline" onClick={toggleLock}>
              {s("Cancel")}
            </Button>
            <ReadOnlyNote show={readOnly} />
          </div>
          {busy ? (
            <p role="status" className="flex items-center gap-2 text-muted-foreground">
              <Loader className="size-4 animate-spin" aria-hidden="true" />
              {s("Testing…")}
            </p>
          ) : null}
        </div>
      )}
      <EmbeddingRunStatus run={run} onRetry={retry} />
      {message && (
        <p role={failed ? "alert" : "status"} className="text-sm">
          {message}
        </p>
      )}
      {dialog}
    </section>
  );
}
