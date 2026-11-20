import { useState } from "react";
import { Loader } from "lucide-react";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsSnapshot } from "@/hooks/useSettingsSnapshot";
import { useOpenRouterModels } from "@/hooks/useOpenRouterModels";
import { Callout } from "$lib/components/skills/Callout";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Select } from "$lib/components/ui/select";
import {
  keyEntered,
  keySourceBody,
  testFailureText,
  testKeyValue,
  type ExternalTestReply,
  type KeySource,
} from "$lib/external-api-settings";
import { useCardText } from "$lib/i18n/settings-cards";
import { applyOpenRouterPreset, isOpenRouterUrl } from "$lib/openrouter-routing";
import { providerName } from "$lib/provider-names";
import { reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { saveSettingEdits } from "$lib/settings-save";
import { KeySourceField, type KeyChoice, type SavedKey } from "./KeySourceField";
import { OpenRouterRouting } from "./OpenRouterRouting";
import { ReasoningLevel } from "./ReasoningLevel";
import { SettingRow } from "./SettingRow";

type Snapshot = {
  revision: string;
  readOnly?: boolean;
  settings: Record<string, { globalValue?: unknown } | undefined>;
  externalKey?: NonNullable<SavedKey> & { warning: string | null };
  openrouterProvider?: Record<string, unknown> | null;
  memoryReasoning?: Record<string, unknown>;
};

const PROVIDERS = [
  "openai-chat",
  "openai-responses",
  "anthropic",
  "minimax",
  "orcarouter",
  "google-gemini",
];
const URL_PATTERN = /^https?:\/\/\S+$/;

export function ExternalApiSection() {
  const t = useCardText();
  const { snapshot, error: loadError } = useSettingsSnapshot<Snapshot>();
  const { ask, dialog } = useSettingsConfirm();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [source, setSource] = useState<KeySource>("file");
  const [keyInput, setKeyInput] = useState({ name: "", path: "", value: "" });
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [statusCode, setStatusCode] = useState<number>();
  const [working, setWorking] = useState("");
  const busy = working !== "";

  const saved = (key: string) => String(snapshot?.settings[key]?.globalValue ?? "");
  const value = (key: string) => fields[key] ?? saved(key);
  const onOpenRouter = isOpenRouterUrl(value("memoryApiUrl"));
  const modelSuggestions = useOpenRouterModels(
    onOpenRouter || isOpenRouterUrl(saved("memoryApiUrl"))
  );
  const readOnly = snapshot?.readOnly === true;

  const url = value("memoryApiUrl").trim();
  const urlProblem = url !== "" && !URL_PATTERN.test(url);
  const edits: Record<string, string | null> = {};
  const provider = value("memoryProvider");
  if (provider && provider !== saved("memoryProvider")) edits.memoryProvider = provider;
  for (const key of ["memoryApiUrl", "memoryModel"]) {
    const next = value(key).trim();
    if (next !== saved(key)) edits[key] = next === "" ? null : next;
  }
  const hasKey = keyEntered(source, keyInput);
  const changed = Object.keys(edits).length > 0 || hasKey;

  function report(ok: boolean, text: string, status?: number) {
    setFailed(!ok);
    setMessage(text);
    setStatusCode(status);
  }

  /** Saves the key source and returns the config revision it wrote. */
  async function postKey(revision: string, replace: boolean): Promise<string> {
    const body = keySourceBody(source, { ...keyInput, replace });
    const reply = await settingsRequest<{ revision?: string }>("/api/settings/external-api/key", {
      method: "POST",
      body: JSON.stringify({ ...body, setting: "memoryApiKey", revision }),
    });
    // Every key field empties: the pasted key leaves the page, and Save turns off.
    setKeyInput({ name: "", path: "", value: "" });
    return reply.revision ?? revision;
  }

  /** The endpoint and model edits, after the key. Returns an error message, or "" on success. */
  async function saveEdits(revision: string): Promise<string> {
    if (Object.keys(edits).length === 0) return "";
    const result = await saveSettingEdits(revision, edits);
    if (!result.success) return result.error ?? "";
    setFields({});
    return "";
  }

  async function finish(problem: string) {
    await reloadSettingsSnapshot();
    setWorking("");
    report(
      problem === "",
      problem ? t(problem) : t("Saved. New capture and profile work uses these settings.")
    );
  }

  async function save() {
    if (!snapshot || !changed || urlProblem) return;
    report(true, "");
    if (hasKey) {
      // Check the key here first, so a bad key saves neither the key nor the endpoint.
      try {
        keySourceBody(source, keyInput);
      } catch (cause) {
        report(false, t((cause as Error).message));
        return;
      }
    }
    // An emptied address or model turns the external API off: there is nothing to call.
    const turnsOff =
      provider !== "orcarouter" && (url === "" || value("memoryModel").trim() === "");
    if (turnsOff) return persist(snapshot.revision);
    // The same test as the Test button, once: only a key the provider accepts is saved.
    setWorking("save");
    let reply: ExternalTestReply;
    try {
      reply = await runTest();
    } catch (cause) {
      setWorking("");
      report(false, t((cause as Error).message));
      return;
    }
    if (reply.ok) return persist(snapshot.revision);
    setWorking("");
    if (reply.reason !== "unreachable") {
      report(false, `${t(testFailureText(reply.reason))} ${t("Nothing was saved.")}`, reply.status);
      return;
    }
    const revision = snapshot.revision;
    ask({
      title: t("Save without a working test?"),
      body: (
        <p>
          {t(testFailureText(reply.reason))}{" "}
          {t("Save these settings anyway? Capture fails until OMMS can reach the address.")}
        </p>
      ),
      confirmLabel: t("Save anyway"),
      busyLabel: t("Saving…"),
      // The dialog closes; the card shows the save's progress and result.
      run: async () => {
        void persist(revision);
        return { success: true };
      },
    });
  }

  /** Saves the key, then the endpoint and model edits. A key file with this name asks first. */
  async function persist(start: string) {
    let revision = start;
    setWorking("save");
    if (hasKey) {
      try {
        revision = await postKey(revision, false);
      } catch (cause) {
        const reason = (cause as Error).message;
        setWorking("");
        await reloadSettingsSnapshot();
        if (source === "paste" && reason.includes("Confirm to replace")) {
          ask({
            title: t("Replace the key file?"),
            body: <p>{t("A key file with this name already exists. Replace it?")}</p>,
            confirmLabel: t("Replace"),
            busyLabel: t("Saving…"),
            destructive: true,
            run: async () => {
              try {
                const problem = await saveEdits(await postKey(revision, true));
                await reloadSettingsSnapshot();
                report(problem === "", problem ? t(problem) : t("Key source saved."));
                return problem ? { success: false, error: t(problem) } : { success: true };
              } catch (error) {
                return { success: false, error: t((error as Error).message) };
              }
            },
          });
          return;
        }
        report(false, t(reason));
        return;
      }
    }
    await finish(await saveEdits(revision));
  }

  /** One test call with the form's values, saved or not. A pasted key is used for it only. */
  function runTest(): Promise<ExternalTestReply> {
    const key = testKeyValue(source, keyInput);
    return settingsRequest<ExternalTestReply>("/api/settings/external-api/test", {
      method: "POST",
      body: JSON.stringify({
        provider: provider || "openai-chat",
        url,
        model: value("memoryModel").trim(),
        ...(key === undefined ? {} : { key }),
      }),
    });
  }

  async function test() {
    setWorking("test");
    report(true, "");
    try {
      const reply = await runTest();
      const model = value("memoryModel").trim();
      report(
        reply.ok,
        reply.ok
          ? t("The test call worked: {provider}, model {model}.", {
              provider: providerName(provider || "openai-chat"),
              model: model || t("its own default"),
            })
          : t(testFailureText(reply.reason)),
        reply.status
      );
    } catch (error) {
      report(false, t((error as Error).message));
    }
    setWorking("");
  }

  function removeRouting() {
    ask({
      title: t("Remove OpenRouter routing?"),
      body: <p>{t("Requests to this endpoint will no longer carry the routing choices.")}</p>,
      confirmLabel: t("Remove"),
      busyLabel: t("Removing OpenRouter routing…"),
      destructive: true,
      run: async () => {
        setWorking("routing");
        report(true, "");
        let failure: string | undefined;
        try {
          await settingsRequest("/api/settings/external-api/openrouter-routing", {
            method: "POST",
            body: JSON.stringify({ revision: snapshot!.revision, routing: null }),
          });
        } catch (error) {
          failure = (error as Error).message;
        }
        await reloadSettingsSnapshot();
        setWorking("");
        report(failure === undefined, failure ?? t("OpenRouter routing removed."));
        return failure === undefined ? { success: true } : { success: false, error: failure };
      },
    });
  }

  const key = snapshot?.externalKey;
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={t("External API")}
    >
      <h2 className="text-section-title font-semibold">{t("External API")}</h2>
      <p className="text-sm text-muted-foreground">
        {t(
          "An OpenAI- or Anthropic-compatible endpoint that OpenCode, Pi and Claude Code can use for capture and backfill. Claude Code needs it for capture."
        )}
      </p>
      {loadError ? <p role="alert">{loadError}</p> : null}
      <div className="space-y-1">
        <Label htmlFor="external-api-preset" className="font-medium">
          {t("Preset")}
        </Label>
        <Select
          id="external-api-preset"
          aria-label={t("Preset")}
          value={isOpenRouterUrl(value("memoryApiUrl")) ? "openrouter" : "custom"}
          onChange={(event) => {
            if (event.target.value === "openrouter") setFields(applyOpenRouterPreset(fields));
            // Custom clears the URL so the user types their own. Model and key stay as they are.
            else setFields({ ...fields, memoryApiUrl: "" });
          }}
        >
          <option value="custom">{t("Custom")}</option>
          <option value="openrouter">OpenRouter</option>
        </Select>
      </div>
      <SettingRow setting="memoryProvider" controlId="external-api-provider">
        <Select
          id="external-api-provider"
          aria-label={t("Provider")}
          value={provider || "openai-chat"}
          onChange={(event) => setFields({ ...fields, memoryProvider: event.target.value })}
        >
          {PROVIDERS.map((id) => (
            <option key={id} value={id}>
              {providerName(id)}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow setting="memoryApiUrl" controlId="external-api-url">
        <Input
          id="external-api-url"
          dir="ltr"
          className="font-mono"
          placeholder="https://api.example.com/v1"
          value={value("memoryApiUrl")}
          aria-invalid={urlProblem}
          onChange={(event) => setFields({ ...fields, memoryApiUrl: event.target.value })}
        />
        {urlProblem ? (
          <p className="mt-1 text-xs text-destructive-label">
            {t("The URL must start with http:// or https://.")}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              "Empty turns the external API off, except for OrcaRouter, which has its own address."
            )}
          </p>
        )}
      </SettingRow>
      <SettingRow setting="memoryModel" controlId="external-api-model">
        <Input
          id="external-api-model"
          dir="ltr"
          className="font-mono"
          placeholder="glm-5-turbo"
          list={onOpenRouter && modelSuggestions.length > 0 ? "openrouter-models" : undefined}
          value={value("memoryModel")}
          onChange={(event) => setFields({ ...fields, memoryModel: event.target.value })}
        />
        {onOpenRouter && modelSuggestions.length > 0 && (
          <datalist id="openrouter-models">
            {modelSuggestions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </datalist>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Empty turns the external API off, except for OrcaRouter, which picks its own model.")}
        </p>
      </SettingRow>
      {snapshot && (
        <ReasoningLevel
          revision={snapshot.revision}
          saved={snapshot.memoryReasoning}
          savedUrl={saved("memoryApiUrl")}
          savedProvider={saved("memoryProvider") || "openai-chat"}
          savedModel={saved("memoryModel")}
          unsaved={Object.keys(edits).length > 0}
          models={modelSuggestions}
          readOnly={readOnly}
        />
      )}
      {snapshot && isOpenRouterUrl(value("memoryApiUrl")) && (
        <OpenRouterRouting
          model={value("memoryModel")}
          savedModel={saved("memoryModel")}
          revision={snapshot.revision}
          saved={snapshot.openrouterProvider ?? null}
          savedIsOpenRouter={isOpenRouterUrl(saved("memoryApiUrl"))}
          readOnly={readOnly}
        />
      )}
      {snapshot && !isOpenRouterUrl(saved("memoryApiUrl")) && snapshot.openrouterProvider && (
        <Callout tone="warning">
          <p>
            {t(
              "OpenRouter routing is still saved and is sent with every request to this endpoint."
            )}
          </p>
          <Button variant="outline" disabled={busy} onClick={removeRouting}>
            {t("Remove OpenRouter routing")}
          </Button>
          {working === "routing" && (
            <p role="status" className="flex items-center gap-2 text-muted-foreground">
              <Loader className="size-4 animate-spin" aria-hidden="true" />
              {t("Removing OpenRouter routing…")}
            </p>
          )}
        </Callout>
      )}
      <SettingRow setting="memoryApiKey" controlId="external-api-key-source">
        <KeySourceField
          id="external-api-key"
          choice={source}
          onChoice={(choice: KeyChoice) => choice !== "none" && setSource(choice)}
          input={keyInput}
          onInput={setKeyInput}
          saved={key}
          disabled={busy}
        />
        {key?.source && !key.resolvesInWebApp ? (
          <p className="mt-1 text-xs text-status-warning">
            {t("The key does not resolve in this web app. Save it to a key file instead.")}
          </p>
        ) : null}
      </SettingRow>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={busy || !snapshot || readOnly || !changed || urlProblem}
          onClick={() => void save()}
        >
          {t("Save settings")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !snapshot}
          onClick={() => void test()}
        >
          {t("Test")}
        </Button>
        {readOnly ? (
          <p className="text-xs text-muted-foreground">
            {t("Saving is turned off until the file is fixed.")}
          </p>
        ) : null}
        {working === "save" || working === "test" ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t(working === "test" ? "Testing…" : "Saving…")}
          </p>
        ) : null}
      </div>
      {message ? (
        <div role={failed ? "alert" : "status"} className="text-sm">
          <p>{message}</p>
          {statusCode ? (
            <p className="text-xs text-muted-foreground">
              {t("Status code {status}", { status: statusCode })}
            </p>
          ) : null}
        </div>
      ) : null}
      {dialog}
    </section>
  );
}
