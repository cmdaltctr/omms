/** Languages offered for memory summaries. Names stay in their own language, so they are not translated. */
export const CAPTURE_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "zh", name: "中文" },
  { code: "ja", name: "日本語" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "ru", name: "Русский" },
  { code: "pt", name: "Português" },
  { code: "ar", name: "العربية" },
  { code: "ko", name: "한국어" },
] as const;

/** The setting is "auto" or a language code. A missing value means the default, "auto". */
export function currentCaptureLanguage(value: unknown): string {
  return typeof value === "string" && value ? value : "auto";
}

/** Options for the picker. A code saved by hand in the config file stays selectable. */
export function captureLanguageOptions(current: string): { code: string; name?: string }[] {
  const known: { code: string; name?: string }[] = [...CAPTURE_LANGUAGES];
  if (current !== "auto" && !known.some((entry) => entry.code === current)) {
    known.push({ code: current });
  }
  return known;
}
