import { expect, it } from "bun:test";
import { translations } from "../web/src/lib/i18n/translations.js";

it("has every English web page text in Chinese and Arabic", () => {
  const english = Object.keys(translations.en);
  for (const lang of ["zh", "ar"] as const) {
    const texts = translations[lang] as Record<string, string>;
    const missing = english.filter((key) => !texts[key]);
    expect({ lang, missing }).toEqual({ lang, missing: [] });
  }
});

it("has the power button texts in every language", () => {
  for (const lang of ["en", "zh", "ar"] as const) {
    const texts = translations[lang] as Record<string, string>;
    for (const key of ["power-button", "power-restart", "power-stop", "power-note"]) {
      expect(texts[key]).toBeTruthy();
    }
    // The note names the terminal command that brings the web app back.
    expect(texts["power-note"]).toContain("om-memory-system web install");
  }
});
