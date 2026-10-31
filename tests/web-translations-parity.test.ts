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

it("has the skill fact texts in every language", () => {
  const keys = [
    "chat-legend-skill",
    "chat-source-skill",
    "chat-skill-uses",
    "chat-skill-failed",
    "chat-skill-attention",
    "chat-skill-modified",
    "chat-skill-modified-yes",
    "chat-skill-modified-no",
    "chat-skill-modified-note",
    "chat-skill-window",
    "chat-skill-history",
    "chat-skill-history-empty",
    "chat-skill-missing",
    "chat-skill-kind-created",
    "chat-skill-kind-applied",
    "chat-skill-kind-rejected",
    "chat-skill-kind-undone",
    "chat-skill-kind-stale",
    "chat-skill-by-person",
    "chat-skill-by-agent",
    "chat-skill-by-automatic",
    "chat-search-skills",
    "chat-search-skill-intent",
    "chat-intent-none",
    "chat-intent-needs-work",
    "chat-intent-most-used",
    "chat-skill-facts-unavailable",
    "chat-skill-privacy",
  ];
  for (const lang of ["en", "zh", "ar"] as const) {
    const texts = translations[lang] as Record<string, string>;
    expect({ lang, missing: keys.filter((key) => !texts[key]) }).toEqual({ lang, missing: [] });
  }
  expect(translations.en["chat-legend-skill" as never]).toBe("skill (usage and change history)");
});
