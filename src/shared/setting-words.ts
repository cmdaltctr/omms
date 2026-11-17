// Plain words for the external API settings that live capture still needs. The
// readiness check reports config key names ("memoryApiKey is not configured");
// users see these words instead. The Claude Code setup line and the web welcome
// panel both use it, so it imports nothing.

export type SettingWordsLanguage = "en" | "zh" | "ar";

const WORDS: Record<string, Record<SettingWordsLanguage, string>> = {
  memoryModel: { en: "model", zh: "模型", ar: "النموذج" },
  memoryApiUrl: { en: "API URL", zh: "API 地址", ar: "عنوان API" },
  memoryApiKey: { en: "API key", zh: "API 密钥", ar: "مفتاح API" },
};
const OTHER: Record<SettingWordsLanguage, string> = {
  en: "settings",
  zh: "设置",
  ar: "الإعدادات",
};
const SEPARATOR: Record<SettingWordsLanguage, string> = { en: ", ", zh: "、", ar: "، " };

/** The missing settings named in `issues`, each once, as one plain list. */
export function missingSettingsText(
  issues: string[],
  language: SettingWordsLanguage = "en"
): string {
  const words = new Set(
    issues.map((issue) => WORDS[issue.split(" ")[0] ?? ""]?.[language] ?? OTHER[language])
  );
  return [...words].join(SEPARATOR[language]);
}
