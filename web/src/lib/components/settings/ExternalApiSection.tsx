import { useEffect, useState } from "react";
import { Select } from "$lib/components/ui/select";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
} from "$lib/settings-api";
import { keySourceBody, type KeySource } from "$lib/external-api-settings";
import { useSettingsText } from "$lib/i18n/settings";

type Snapshot = {
  revision: string;
  settings: Record<string, { globalValue?: unknown }>;
  externalKey?: {
    source: "env" | "file" | "literal" | null;
    reference: string | null;
    resolvesInWebApp: boolean;
    warning: string | null;
  };
};

const PROVIDERS = [
  "openai-chat",
  "openai-responses",
  "anthropic",
  "minimax",
  "orcarouter",
  "google-gemini",
];

export function ExternalApiSection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [source, setSource] = useState<KeySource>("file");
  const [keyInput, setKeyInput] = useState({ name: "", path: "", value: "" });
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
    const unsubscribe = onSettingsSnapshot((value) => {
      if (active) setSnapshot(value as Snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const saved = (key: string) => String(snapshot?.settings[key]?.globalValue ?? "");
  const value = (key: string) => fields[key] ?? saved(key);

  async function saveEndpoint() {
    if (!snapshot) return;
    const edits: Record<string, string> = {};
    for (const key of ["memoryProvider", "memoryApiUrl", "memoryModel"]) {
      const next = value(key).trim();
      if (next && next !== saved(key)) edits[key] = next;
    }
    if (!Object.keys(edits).length) {
      setMessage(s("Nothing to save."));
      return;
    }
    setBusy(true);
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
      setFields({});
      setMessage(s("Saved. New capture and profile work uses these settings."));
    } catch (error) {
      setMessage((error as Error).message);
    }
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
  }

  async function saveKey(replace = false) {
    if (!snapshot) return;
    let body;
    try {
      body = keySourceBody(source, { ...keyInput, replace });
    } catch (error) {
      setMessage(s((error as Error).message));
      return;
    }
    setBusy(true);
    try {
      await settingsRequest("/api/settings/external-api/key", {
        method: "POST",
        body: JSON.stringify({ ...body, revision: snapshot.revision }),
      });
      // The pasted key is dropped from the page as soon as it is saved.
      setKeyInput((previous) => ({ ...previous, value: "" }));
      setMessage(s("Key source saved."));
    } catch (error) {
      const text = (error as Error).message;
      if (source === "paste" && !replace && text.includes("Confirm to replace")) {
        setBusy(false);
        if (window.confirm(s("A key file with this name exists. Replace it?"))) {
          await saveKey(true);
        }
        return;
      }
      setMessage(text);
    }
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    try {
      const result = await settingsRequest<{ ok: boolean; model?: string; error?: string }>(
        "/api/settings/external-api/test",
        { method: "POST", body: "{}" }
      );
      setMessage(
        result.ok
          ? `${s("Test call succeeded")}: ${result.model ?? ""}`
          : `${s("Test call failed")}: ${result.error ?? ""}`
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
    setBusy(false);
  }

  const key = snapshot?.externalKey;
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("External API")}
    >
      <h2 className="text-lg font-medium">{s("External API")}</h2>
      <p className="text-sm text-muted-foreground">
        {s(
          "An OpenAI- or Anthropic-compatible endpoint that either host can use for capture and backfill."
        )}
      </p>
      <label className="block text-sm">
        {s("Provider")}
        <Select
          aria-label={s("Provider")}
          className="mt-1 block w-full rounded border border-border bg-background p-2"
          value={value("memoryProvider") || "openai-chat"}
          onChange={(event) => setFields({ ...fields, memoryProvider: event.target.value })}
        >
          {PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </Select>
      </label>
      <label className="block text-sm">
        {s("API URL")}
        <input
          dir="ltr"
          className="mt-1 block w-full rounded border border-border bg-background p-2 font-mono"
          placeholder="https://api.example.com/v1"
          value={value("memoryApiUrl")}
          onChange={(event) => setFields({ ...fields, memoryApiUrl: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        {s("Model")}
        <input
          dir="ltr"
          className="mt-1 block w-full rounded border border-border bg-background p-2 font-mono"
          placeholder="glm-5-turbo"
          value={value("memoryModel")}
          onChange={(event) => setFields({ ...fields, memoryModel: event.target.value })}
        />
      </label>
      <button
        type="button"
        className="rounded border border-border px-3 py-1.5 text-sm"
        disabled={busy || !snapshot}
        onClick={() => void saveEndpoint()}
      >
        {s("Save endpoint")}
      </button>

      <fieldset className="space-y-2 rounded-lg border border-border p-3 text-sm">
        <legend className="px-1 font-medium">{s("API key")}</legend>
        <p className="text-xs text-muted-foreground">
          {s("Key source")}:{" "}
          {key?.source === "env"
            ? `${s("environment variable")} ${key.reference}`
            : key?.source === "file"
              ? `${s("key file")} ${key.reference}`
              : key?.source === "literal"
                ? s("set in the config file")
                : s("not set")}
          {key?.source &&
            ` · ${s(key.resolvesInWebApp ? "resolves in the web app" : "does not resolve in the web app")}`}
        </p>
        {key?.source === "env" && (
          <p className="text-xs text-amber-600">
            {s(
              "A login web app does not see variables set only in a shell profile; a key file works everywhere."
            )}
          </p>
        )}
        {key?.source && !key.resolvesInWebApp && (
          <p className="text-xs text-amber-600">
            {s("The key does not resolve in this web app. Save it to a key file instead.")}
          </p>
        )}
        {(
          [
            ["env", "Environment variable"],
            ["file", "Key file"],
            ["paste", "Save key to a private file"],
          ] as const
        ).map(([id, label]) => (
          <label key={id} className="flex items-center gap-2">
            <input
              type="radio"
              name="omms-key-source"
              checked={source === id}
              onChange={() => setSource(id)}
            />
            {s(label)}
          </label>
        ))}
        {source === "env" && (
          <input
            aria-label={s("Variable name")}
            className="w-full rounded border border-border bg-background p-2"
            placeholder="ZAI_API_KEY"
            value={keyInput.name}
            onChange={(event) => setKeyInput({ ...keyInput, name: event.target.value })}
          />
        )}
        {source === "file" && (
          <input
            aria-label={s("Key file path")}
            className="w-full rounded border border-border bg-background p-2"
            placeholder="~/.config/omms/secrets/zai.key"
            value={keyInput.path}
            onChange={(event) => setKeyInput({ ...keyInput, path: event.target.value })}
          />
        )}
        {source === "paste" && (
          <>
            <input
              aria-label={s("Key file name")}
              className="w-full rounded border border-border bg-background p-2"
              placeholder="memory-api"
              value={keyInput.name}
              onChange={(event) => setKeyInput({ ...keyInput, name: event.target.value })}
            />
            <input
              aria-label={s("API key")}
              type="password"
              autoComplete="off"
              className="w-full rounded border border-border bg-background p-2"
              value={keyInput.value}
              onChange={(event) => setKeyInput({ ...keyInput, value: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {s(
                "The key is written to ~/.config/omms/secrets/ readable only by you. It is never shown again."
              )}
            </p>
          </>
        )}
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5"
          disabled={busy || !snapshot}
          onClick={() => void saveKey()}
        >
          {s("Save key source")}
        </button>
      </fieldset>
      <button
        type="button"
        className="rounded border border-border px-3 py-1.5 text-sm"
        disabled={busy}
        onClick={() => void test()}
      >
        {s("Test")}
      </button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
