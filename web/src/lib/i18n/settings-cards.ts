import { useI18n } from "./index";
import { translateSettings } from "./settings";
import { settingsCatalogueText, translateCatalogue } from "./settings-catalogue";

/**
 * The translator for the Settings page cards. New card texts live in `settings-cards-text.ts`
 * and the catalogue tables, older wording in `settings.ts`. A text found in the first group wins;
 * any other text goes through `settings.ts`. `{name}` is replaced from `params`.
 */
export function useCardText() {
  const { language } = useI18n();
  return (message: string, params?: Record<string, string | number>): string =>
    message in settingsCatalogueText
      ? translateCatalogue(message, language, params)
      : translateCatalogue(translateSettings(message, language), "en", params);
}
