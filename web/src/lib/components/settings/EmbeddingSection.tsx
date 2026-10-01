import { useEffect, useState } from "react";
import { Select } from "$lib/components/ui/select";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
} from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
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
type Snapshot = { revision: string; secrets: Record<string, { set: boolean } | undefined> };

/** The embedder in use, read-only, as the locked card shows it. */
export function EmbeddingSummary({
  current,
  keySet,
}: {
  current: CurrentEmbedding;
  keySet: boolean;
}) {
  const s = useSettingsText();
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
  const s = useSettingsText();
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
          <button
            type="button"
            className="rounded border border-border px-3 py-1.5"
            onClick={onRetry}
          >
            {s("Retry")}
          </button>
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
  const s = useSettingsText();
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
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      const result = await settingsRequest<{ ok: boolean; dimensions?: number; reason?: string }>(
        "/api/settings/embedding/test",
        { method: "POST", body: JSON.stringify(candidateBody(fields)) }
      );
      if (result.ok && result.dimensions) {
        setPassed({ key: candidateKey(fields), dimensions: result.dimensions });
        setMessage(`${s("Test passed. Vector size")}: ${result.dimensions}`);
      } else {
        setPassed(undefined);
        setMessage(`${s("Test failed")}: ${result.reason ?? ""}`);
      }
    } catch (error) {
      setMessage(s((error as Error).message));
    }
    setBusy(false);
  }

  async function apply() {
    if (!fields || !current || !snapshot) return;
    const { count, risks } = confirmation(current.memoryCount, fields);
    const text = [
      `${s("Every stored memory will be re-embedded")}: ${count}`,
      ...risks.map((risk) => s(risk)),
    ].join("\n");
    if (!window.confirm(text)) return;
    setBusy(true);
    try {
      const started = await settingsRequest<EmbeddingRun>("/api/settings/embedding/apply", {
        method: "POST",
        body: JSON.stringify({ candidate: candidateBody(fields), revision: snapshot.revision }),
      });
      setRun(started);
      setUnlocked(false);
      setFields(undefined);
      setPassed(undefined);
      setMessage("");
    } catch (error) {
      setMessage((error as Error).message);
    }
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
  }

  async function retry() {
    try {
      setRun(
        await settingsRequest<EmbeddingRun>("/api/settings/embedding/run", {
          method: "POST",
          body: "{}",
        })
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  const keySet = Boolean(snapshot?.secrets.embeddingApiKey?.set);
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Embedding")}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{s("Embedding")}</h2>
        {local && (
          <button
            type="button"
            aria-label={s(unlocked ? "Lock" : "Unlock to change")}
            title={s(unlocked ? "Lock" : "Unlock to change")}
            className="rounded border border-border px-2 py-1"
            disabled={!current || run.state === "running"}
            onClick={toggleLock}
          >
            {unlocked ? "🔓" : "🔒"}
          </button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {s(
          "The model that turns memory text into search vectors. A change re-embeds every memory."
        )}
      </p>
      {current && !unlocked && <EmbeddingSummary current={current} keySet={keySet} />}
      {unlocked && fields && (
        <div className="space-y-2 text-sm">
          {(["builtin", "server"] as const).map((kind) => (
            <label key={kind} className="flex items-center gap-2">
              <input
                type="radio"
                name="omms-embedding-kind"
                checked={fields.kind === kind}
                onChange={() =>
                  edit(
                    kindChange(
                      kind,
                      current?.kind === "builtin" ? current.model : DEFAULT_BUILTIN_MODEL
                    )
                  )
                }
              />
              {s(kind === "server" ? "OpenAI-compatible server" : "Built-in model")}
            </label>
          ))}
          {fields.kind === "server" && (
            <>
              <label className="block">
                {s("Preset")}
                <Select
                  aria-label={s("Preset")}
                  className="mt-1 block w-full rounded border border-border bg-background p-2"
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
              </label>
              <label className="block">
                {s("Server URL")}
                <input
                  className="mt-1 block w-full rounded border border-border bg-background p-2"
                  value={fields.url}
                  onChange={(event) => edit({ url: event.target.value })}
                />
              </label>
            </>
          )}
          <label className="block">
            {s("Model")}
            <input
              className="mt-1 block w-full rounded border border-border bg-background p-2"
              placeholder={
                fields.kind === "server" ? "nomic-embed-text" : "Xenova/nomic-embed-text-v1"
              }
              value={fields.model}
              onChange={(event) => edit({ model: event.target.value })}
            />
          </label>
          {fields.kind === "server" && (
            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 font-medium">{s("API key")}</legend>
              {(
                [
                  ["none", "No key"],
                  ...(keySet ? ([["saved", "Keep the saved key"]] as const) : []),
                  ["env", "Environment variable"],
                  ["file", "Key file"],
                  ["paste", "Save key to a private file"],
                ] as const
              ).map(([id, label]) => (
                <label key={id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="omms-embedding-key"
                    checked={fields.key === id}
                    onChange={() => edit({ key: id })}
                  />
                  {s(label)}
                </label>
              ))}
              {fields.key === "env" && (
                <input
                  aria-label={s("Variable name")}
                  className="w-full rounded border border-border bg-background p-2"
                  placeholder="OPENROUTER_API_KEY"
                  value={fields.keyInput.name}
                  onChange={(event) =>
                    edit({ keyInput: { ...fields.keyInput, name: event.target.value } })
                  }
                />
              )}
              {fields.key === "file" && (
                <input
                  aria-label={s("Key file path")}
                  className="w-full rounded border border-border bg-background p-2"
                  value={fields.keyInput.path}
                  onChange={(event) =>
                    edit({ keyInput: { ...fields.keyInput, path: event.target.value } })
                  }
                />
              )}
              {fields.key === "paste" && (
                <input
                  aria-label={s("API key")}
                  type="password"
                  autoComplete="off"
                  className="w-full rounded border border-border bg-background p-2"
                  value={fields.keyInput.value}
                  onChange={(event) =>
                    edit({ keyInput: { ...fields.keyInput, value: event.target.value } })
                  }
                />
              )}
            </fieldset>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5"
              disabled={busy || !fields.model.trim()}
              onClick={() => void test()}
            >
              {s("Test")}
            </button>
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5"
              disabled={busy || !canApply(passed?.key, fields)}
              onClick={() => void apply()}
            >
              {s("Apply")}
            </button>
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5"
              onClick={toggleLock}
            >
              {s("Cancel")}
            </button>
          </div>
        </div>
      )}
      <EmbeddingRunStatus run={run} onRetry={() => void retry()} />
      {message && <p className="text-sm">{message}</p>}
    </section>
  );
}
