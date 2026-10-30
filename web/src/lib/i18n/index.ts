import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getDateFormat, subscribeDateFormat, type DateFormatChoice } from "../date-format";
import { htmlLangFor } from "../document-head";
import { readPreference, writePreference } from "../preferences";
import { translations, type Lang, type TranslationKey } from "./translations";

const LANGS: Lang[] = ["en", "zh", "ar"];

export type TranslateFn = (
  key: TranslationKey | string,
  params?: Record<string, string | number>
) => string;

const LANG_STORAGE_KEY = "omms-lang";
const LEGACY_LANG_STORAGE_KEY = "opencode-mem-lang";

function readLang(): Lang {
  if (typeof window === "undefined") return "en";
  const stored = readPreference(LANG_STORAGE_KEY, LEGACY_LANG_STORAGE_KEY);
  if (stored === "en" || stored === "zh" || stored === "ar") return stored;
  return "en";
}

let currentLang: Lang = readLang();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function applyLang(lang: Lang) {
  currentLang = lang;
  if (typeof document !== "undefined") {
    writePreference(LANG_STORAGE_KEY, lang);
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = htmlLangFor(lang);
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return currentLang;
}

function getServerSnapshot(): Lang {
  return "en";
}

export function getLanguage(): Lang {
  return currentLang;
}

export function setLanguage(lang: Lang) {
  applyLang(lang);
}

export function cycleLanguage(): Lang {
  const next = LANGS[(LANGS.indexOf(getLanguage()) + 1) % LANGS.length];
  setLanguage(next);
  return next;
}

export function t(
  key: TranslationKey | string,
  params: Record<string, string | number> = {},
  lang: Lang = getLanguage()
): string {
  let text =
    (translations[lang] as Record<string, string>)[key] ||
    (translations.en as Record<string, string>)[key] ||
    key;

  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return text;
}

type I18nContextValue = {
  language: Lang;
  t: TranslateFn;
  /** The date and time format; a change re-renders every reader of this context. */
  dateFormat: DateFormatChoice;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function useLanguageStore(): Lang {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function useDateFormatStore(): DateFormatChoice {
  return useSyncExternalStore(subscribeDateFormat, getDateFormat, getDateFormat);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const language = useLanguageStore();
  const dateFormat = useDateFormatStore();
  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      t: (key, params = {}) => t(key, params, language),
      dateFormat,
    }),
    [language, dateFormat]
  );

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  const language = useLanguageStore();
  const dateFormat = useDateFormatStore();
  return useMemo(
    () =>
      ctx ?? {
        language,
        t: (key, params = {}) => t(key, params, language),
        dateFormat,
      },
    [ctx, language, dateFormat]
  );
}

if (typeof document !== "undefined") {
  document.documentElement.dir = currentLang === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = htmlLangFor(currentLang);
}
