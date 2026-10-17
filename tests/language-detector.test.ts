import { describe, it, expect } from "bun:test";
import { detectLanguage, getLanguageName } from "../src/services/language-detector.js";

describe("detectLanguage", () => {
  it("should detect Chinese as zh", () => {
    expect(detectLanguage("这是一个中文测试")).toBe("zh");
  });

  it("should detect short Chinese as zh (5+ chars)", () => {
    expect(detectLanguage("这是一个中文测试")).toBe("zh");
  });

  it("should detect English as en", () => {
    expect(detectLanguage("This is an English test")).toBe("en");
  });

  it("should fallback to en for empty string", () => {
    expect(detectLanguage("")).toBe("en");
  });

  it("should fallback to en for whitespace only", () => {
    expect(detectLanguage("   ")).toBe("en");
  });

  it("should fallback to en for very short undetectable input", () => {
    expect(detectLanguage("ab")).toBe("en");
  });

  // Real short English prompts that franc labelled Somali and Tagalog, which made
  // auto-capture write the memory in the wrong language.
  it.each(["ok go ahead", "eta of it", "why saved map are making messy"])(
    "should treat short Latin-script prompt %p as en",
    (prompt) => {
      expect(detectLanguage(prompt)).toBe("en");
    }
  );

  it("should keep detecting short non-Latin text", () => {
    expect(detectLanguage("Καλημέρα, πώς είσαι σήμερα φίλε μου;")).toBe("el");
  });

  it("should detect a long Latin-script prompt in its own language", () => {
    const french =
      "Bonjour, peux-tu corriger le bug dans la fonction de recherche de souvenirs " +
      "et ajouter un test pour vérifier que le résultat reste stable ?";
    expect(detectLanguage(french)).toBe("fr");
  });
});

describe("getLanguageName", () => {
  it("should return Chinese name for zh", () => {
    const name = getLanguageName("zh");
    expect(name.toLowerCase()).toContain("chinese");
  });

  it("should return English name for en", () => {
    const name = getLanguageName("en");
    expect(name.toLowerCase()).toContain("english");
  });

  it("should fallback to English for unknown code", () => {
    expect(getLanguageName("xyz")).toBe("English");
  });
});
