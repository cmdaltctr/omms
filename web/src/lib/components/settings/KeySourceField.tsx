import { Callout } from "$lib/components/skills/Callout";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Select } from "$lib/components/ui/select";
import { useCatalogueText } from "$lib/i18n/settings-catalogue";
import type { KeySource } from "$lib/external-api-settings";

/** The key sources, plus No key where a key is optional. */
export type KeyChoice = KeySource | "none";
/** What the user typed. Only the field of the chosen source is used. */
export type KeyInput = { name: string; path: string; value: string };
/** The saved key as the server reports it: a source and a reference, never the key itself. */
export type SavedKey = {
  source: "env" | "file" | "literal" | null;
  reference: string | null;
  resolvesInWebApp: boolean;
} | null;

const SOURCE_WORDS = {
  env: "environment variable",
  file: "key file",
  literal: "set in the config file",
} as const;

/**
 * The one key-entry control for the External API, Embedding and Reranker cards: an environment
 * variable, a key file, or a pasted key saved to a private file, plus No key where a key is
 * optional. The card owns the state and builds the request with `keySourceBody`. A pasted key
 * lives only in the form state and is never shown again.
 */
export function KeySourceField({
  id,
  choice,
  onChoice,
  input,
  onInput,
  optional = false,
  saved,
  disabled = false,
  nameHint = "memory-api",
}: {
  /** A unique prefix for the ids of the fields. */
  id: string;
  choice: KeyChoice;
  onChoice: (choice: KeyChoice) => void;
  input: KeyInput;
  onInput: (input: KeyInput) => void;
  optional?: boolean;
  saved?: SavedKey;
  disabled?: boolean;
  /** The file name shown as an example when the key is pasted. */
  nameHint?: string;
}) {
  const t = useCatalogueText();
  const edit = (patch: Partial<KeyInput>) => onInput({ ...input, ...patch });
  const savedWords = saved?.source ? SOURCE_WORDS[saved.source] : null;
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={`${id}-source`}>{t("How OMMS gets the key")}</Label>
      <Select
        id={`${id}-source`}
        aria-label={t("How OMMS gets the key")}
        value={choice}
        disabled={disabled}
        onChange={(event) => onChoice(event.target.value as KeyChoice)}
      >
        <option value="env">{t("Environment variable")}</option>
        <option value="file">{t("Key file")}</option>
        <option value="paste">{t("Save key to a private file")}</option>
        {optional ? <option value="none">{t("No key")}</option> : null}
      </Select>
      {choice === "env" ? (
        <>
          <Input
            dir="ltr"
            aria-label={t("Variable name")}
            placeholder="ZAI_API_KEY"
            value={input.name}
            disabled={disabled}
            onChange={(event) => edit({ name: event.target.value })}
          />
          <Callout tone="warning">
            <p>
              {t(
                "A login web app does not see variables set only in a shell profile. A key file works everywhere."
              )}
            </p>
          </Callout>
        </>
      ) : null}
      {choice === "file" ? (
        <Input
          dir="ltr"
          aria-label={t("Key file path")}
          placeholder="~/.config/omms/secrets/zai.key"
          value={input.path}
          disabled={disabled}
          onChange={(event) => edit({ path: event.target.value })}
        />
      ) : null}
      {choice === "paste" ? (
        <>
          <Input
            dir="ltr"
            aria-label={t("Key file name")}
            placeholder={nameHint}
            value={input.name}
            disabled={disabled}
            onChange={(event) => edit({ name: event.target.value })}
          />
          <Input
            dir="ltr"
            type="password"
            autoComplete="off"
            aria-label={t("Key to save")}
            value={input.value}
            disabled={disabled}
            onChange={(event) => edit({ value: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t(
              "OMMS writes the key to a file that only you can read, in ~/.config/omms/secrets/. It is never shown again."
            )}
          </p>
        </>
      ) : null}
      {choice === "none" ? (
        <p className="text-xs text-muted-foreground">{t("No key is sent.")}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {savedWords && saved ? (
          <>
            {t("Saved key")}: {t(savedWords)}
            {saved.reference ? (
              <>
                {" "}
                <bdi dir="ltr">{saved.reference}</bdi>
              </>
            ) : null}
            {" · "}
            {t(saved.resolvesInWebApp ? "The web app can read it" : "The web app cannot read it")}
          </>
        ) : (
          t("No key is saved")
        )}
      </p>
    </div>
  );
}
