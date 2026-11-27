import { arabicCount } from "./arabic-count";
import { useI18n } from "./index";
import type { Lang } from "./translations";
import { translateSettings } from "./settings";
import { settingsCatalogueText, translateCatalogue } from "./settings-catalogue";

/**
 * Translates one Settings card text. New card texts live in `settings-cards-text.ts` and the
 * catalogue tables, older wording in `settings.ts`. A text found in the first group wins; any
 * other text goes through `settings.ts`. `{name}` is replaced from `params`. An Arabic count of
 * days or hours takes the form its number needs.
 */
export function cardText(
  message: string,
  language: Lang,
  params?: Record<string, string | number>
): string {
  const counted =
    language === "ar" && params?.count !== undefined
      ? arabicCount(message, params.count)
      : undefined;
  if (counted !== undefined) return counted;
  return message in settingsCatalogueText
    ? translateCatalogue(message, language, params)
    : translateCatalogue(translateSettings(message, language), "en", params);
}

/** The translator for the Settings page cards, bound to the page language. */
export function useCardText() {
  const { language } = useI18n();
  return (message: string, params?: Record<string, string | number>): string =>
    cardText(message, language, params);
}
