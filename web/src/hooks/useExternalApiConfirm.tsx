import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import type { ConfirmResult } from "$lib/components/settings/SettingsConfirmDialog";
import type { SavedKey } from "$lib/components/settings/KeySourceField";
import type { KeySource } from "$lib/external-api-settings";
import { useCardText } from "$lib/i18n/settings-cards";
import { providerName } from "$lib/provider-names";

/** The values in force and the edits, keyed as the request spells them. */
export type ExternalApiConfirmState = {
  saved: Record<string, string>;
  edits: Record<string, string | null>;
  /** The key the user entered, when the save writes one. Never the key value itself. */
  key: { source: KeySource; name: string; path: string } | undefined;
  savedKey: SavedKey;
};

export type ExternalApiSaveAsk = {
  title: string;
  /** A sentence before the list, such as the turn-off note. */
  lead?: string;
  confirmLabel: string;
  busyLabel?: string;
  run: () => Promise<ConfirmResult>;
};

const KEY_WORDS = {
  env: "environment variable",
  file: "key file",
  paste: "key file",
  literal: "set in the config file",
} as const;

/** The saved key in words: its source and where it lives, never the key itself. */
function savedKeyWords(t: (message: string) => string, saved: SavedKey): string {
  if (!saved?.source) return t("Not set");
  const words = t(KEY_WORDS[saved.source]);
  return saved.reference ? `${words} ${saved.reference}` : words;
}

/** The entered key in words: where it will live, never the key itself. */
function enteredKeyWords(
  t: (message: string) => string,
  key: { source: KeySource; name: string; path: string }
): string {
  if (key.source === "env") return `${t(KEY_WORDS.env)} ${key.name.trim()}`;
  if (key.source === "file") return `${t(KEY_WORDS.file)} ${key.path.trim()}`;
  return `${t(KEY_WORDS.paste)} ${key.name.trim() || "memory-api"}`;
}

/**
 * Puts each External API save behind the shared confirm dialog, with the change list built from
 * the same edits the save sends. Nothing is sent until the user confirms. `ask` stays free for
 * the card's own special dialogs, which share the one rendered `dialog`.
 */
export function useExternalApiConfirm(state: ExternalApiConfirmState) {
  const t = useCardText();
  const { ask, dialog } = useSettingsConfirm();
  const { changes, name } = useSettingsChanges();
  const fields = [
    {
      key: "memoryProvider",
      label: name("memoryProvider"),
      print: (value: unknown) => (value ? providerName(String(value)) : t("Not set")),
    },
    { key: "memoryApiUrl", label: name("memoryApiUrl") },
    { key: "memoryModel", label: name("memoryModel") },
    { key: "memoryApiKey", label: name("memoryApiKey") },
  ];
  const inForce = { ...state.saved, memoryApiKey: savedKeyWords(t, state.savedKey) };
  const edits = state.key
    ? { ...state.edits, memoryApiKey: enteredKeyWords(t, state.key) }
    : state.edits;

  /** Opens the shared dialog with the change list, after the card's own lead sentence. */
  function askSave(request: ExternalApiSaveAsk) {
    ask({
      title: request.title,
      body: (
        <>
          {request.lead ? <p>{request.lead}</p> : null}
          <SettingsChangeList changes={changes(inForce, edits, fields)} />
        </>
      ),
      confirmLabel: request.confirmLabel,
      busyLabel: request.busyLabel,
      run: request.run,
    });
  }
  return { ask, dialog, askSave };
}
