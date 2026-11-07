import { expect, it } from "bun:test";
import { spaceText } from "../src/lib/i18n/spaces.ts";
import { translateSettings } from "../src/lib/i18n/settings.ts";
import { translations } from "../src/lib/i18n/translations.ts";

const placeholders = (message: string) =>
  [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const english = Object.entries(spaceText.en);

it("has every space text in Chinese and Arabic, in real script, with the same placeholders", () => {
  for (const [key, message] of english) {
    const zh = (spaceText.zh as Record<string, string>)[key];
    const ar = (spaceText.ar as Record<string, string>)[key];
    expect(zh, `zh ${key}`).toMatch(/[一-鿿]/);
    expect(ar, `ar ${key}`).toMatch(/[؀-ۿ]/);
    expect(placeholders(zh!), `zh ${key}`).toEqual(placeholders(message));
    expect(placeholders(ar!), `ar ${key}`).toEqual(placeholders(message));
  }
  expect(Object.keys(spaceText.zh)).toEqual(Object.keys(spaceText.en));
  expect(Object.keys(spaceText.ar)).toEqual(Object.keys(spaceText.en));
});

it("reaches the page translator in all three languages", () => {
  for (const lang of ["en", "zh", "ar"] as const) {
    const table = translations[lang] as Record<string, string>;
    for (const [key] of english) expect(table[key], `${lang} ${key}`).toBeTruthy();
  }
});

it("translates the Largest sort label that the shared toolbar shows", () => {
  expect(translateSettings("Largest", "en")).toBe("Largest");
  expect(translateSettings("Largest", "zh")).toBe("最大");
  expect(translateSettings("Largest", "ar")).toBe("الأكبر");
});

it("labels the sidebar item and the page Spaces in every language", () => {
  expect(spaceText.en["nav-spaces"]).toBe("Spaces");
  expect(spaceText.zh["nav-spaces"]).toBe("空间");
  expect(spaceText.ar["nav-spaces"]).toBe("المساحات");
});

it("has no text for the old popover switcher", () => {
  for (const lang of ["en", "zh", "ar"] as const) {
    expect(Object.keys(spaceText[lang]).filter((key) => key.startsWith("spaces-switcher"))).toEqual(
      []
    );
  }
});

it("has the texts of the edit dialog, the icon buttons and the saved line", () => {
  for (const lang of ["en", "zh", "ar"] as const) {
    const table = spaceText[lang] as Record<string, string>;
    for (const key of [
      "spaces-edit-title",
      "spaces-edit",
      "spaces-edit-name",
      "spaces-edit-name-note",
      "spaces-saving",
      "spaces-saved",
    ]) {
      expect(table[key], `${lang} ${key}`).toBeTruthy();
    }
  }
  expect(spaceText.en["spaces-edit-title"]).toBe("Edit space: {name}");
  expect(spaceText.ar["spaces-edit-title"]).toContain("{name}");
});

it("drops the texts of the old Rename button and dialog", () => {
  for (const lang of ["en", "zh", "ar"] as const) {
    const keys = Object.keys(spaceText[lang]);
    for (const old of [
      "spaces-action-rename",
      "spaces-rename-title",
      "spaces-rename-label",
      "spaces-rename-save",
      "spaces-renaming",
      "spaces-renamed",
      "spaces-rename-note",
    ]) {
      expect(keys, `${lang} ${old}`).not.toContain(old);
    }
  }
});

it("has the texts of the Archive page, the restore confirmation and the archive feedback", () => {
  for (const lang of ["en", "zh", "ar"] as const) {
    const table = spaceText[lang] as Record<string, string>;
    for (const key of [
      "nav-spaces-archive",
      "spaces-archive-intro",
      "spaces-archive-empty",
      "spaces-archive-list-label",
      "spaces-archive-total",
      "spaces-archived-at",
      "spaces-archived-none",
      "spaces-action-restore",
      "spaces-confirm-restore-title",
      "spaces-confirm-restore-body",
      "spaces-restored-space",
      "spaces-archive-open",
    ]) {
      expect(table[key], `${lang} ${key}`).toBeTruthy();
    }
  }
  expect(spaceText.en["nav-spaces-archive"]).toBe("Archive");
  expect(spaceText.ar["nav-spaces-archive"]).toBe("الأرشيف");
});

it("drops the texts of the Unarchive button and its confirmation", () => {
  for (const lang of ["en", "zh", "ar"] as const) {
    const keys = Object.keys(spaceText[lang]);
    for (const old of [
      "spaces-action-unarchive",
      "spaces-confirm-unarchive-title",
      "spaces-confirm-unarchive-body",
      "spaces-unarchiving",
      "spaces-status-archived",
    ]) {
      expect(keys, `${lang} ${old}`).not.toContain(old);
    }
  }
});

it("translates the sort labels of the Archive list", () => {
  expect(translateSettings("Newest archived", "zh")).not.toBe("Newest archived");
  expect(translateSettings("Newest archived", "ar")).not.toBe("Newest archived");
});

it("mirrors the document for Arabic and restores it for other languages", async () => {
  const { setLanguage } = await import("../src/lib/i18n/index.ts");
  const globalScope = globalThis as unknown as { document?: unknown };
  const savedDocument = globalScope.document;
  const element = { dir: "", lang: "" };
  globalScope.document = { documentElement: element };
  try {
    setLanguage("ar");
    expect(element.dir).toBe("rtl");
    setLanguage("en");
    expect(element.dir).toBe("ltr");
  } finally {
    if (savedDocument === undefined) delete globalScope.document;
    else globalScope.document = savedDocument;
    setLanguage("en");
  }
});
