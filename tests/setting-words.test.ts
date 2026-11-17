import { expect, it } from "bun:test";
import { missingSettingsText } from "../src/shared/setting-words.js";

const ISSUES = [
  "memoryModel is not configured",
  "memoryApiKey is not configured",
  "memoryApiKey contains a placeholder value",
];

it("names each missing setting once in plain words", () => {
  expect(missingSettingsText(ISSUES)).toBe("model, API key");
  expect(missingSettingsText(["memoryApiUrl is not configured"])).toBe("API URL");
});

it("has the words in Chinese and Arabic", () => {
  expect(missingSettingsText(ISSUES, "zh")).toBe("模型、API 密钥");
  expect(missingSettingsText(ISSUES, "ar")).toBe("النموذج، مفتاح API");
});

it("never shows a config key name", () => {
  const all = [
    ...ISSUES,
    "memoryApiUrl is not configured",
    "opencodeProvider is not configured",
    "opencodeModel is not configured",
    "something new",
  ];
  for (const language of ["en", "zh", "ar"] as const) {
    expect(missingSettingsText(all, language)).not.toMatch(/memory|opencode[A-Z]|something/);
  }
});
