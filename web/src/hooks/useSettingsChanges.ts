import { useCatalogueText } from "$lib/i18n/settings-catalogue";
import { findCatalogueEntry } from "$lib/settings-catalogue";
import {
  settingsChanges,
  type SettingsChange,
  type SettingsChangeField,
} from "$lib/settings-changes";

/**
 * What a card needs to fill the shared settings confirm dialog. Call `changes` where the card
 * builds its request, so the list and the request body come from the same edits.
 */
export function useSettingsChanges() {
  const t = useCatalogueText();
  const words = {
    on: t("On"),
    off: t("Off"),
    notSet: t("Not set"),
    default: (value: string) => t("Default ({value})", { value }),
  };
  return {
    /** The rows of the change list, in the order of `fields`. */
    changes: (
      saved: Record<string, unknown>,
      edits: Record<string, unknown>,
      fields: readonly SettingsChangeField[]
    ): SettingsChange[] => settingsChanges(saved, edits, fields, words),
    /** A setting's name in the language of the page, or its key when the catalogue has no entry. */
    name: (key: string): string => {
      const entry = findCatalogueEntry(key);
      return entry ? t(entry.name) : key;
    },
  };
}
