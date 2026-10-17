import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { captureLanguageOptions, currentCaptureLanguage } from "../src/lib/capture-language.ts";
import { CaptureLanguageField } from "../src/lib/components/settings/CaptureLanguageSection.tsx";
import { SETTINGS_SECTIONS } from "../src/lib/settings-sections.ts";
import { translateSettings } from "../src/lib/i18n/settings.ts";

it("treats a missing or empty value as auto", () => {
  expect(currentCaptureLanguage(undefined)).toBe("auto");
  expect(currentCaptureLanguage("")).toBe("auto");
  expect(currentCaptureLanguage("fr")).toBe("fr");
});

it("keeps a language code saved by hand selectable", () => {
  expect(captureLanguageOptions("en").map((entry) => entry.code)).not.toContain("fil");
  expect(captureLanguageOptions("fil").map((entry) => entry.code)).toContain("fil");
  expect(captureLanguageOptions("auto").map((entry) => entry.code)).not.toContain("auto");
});

it("shows the saved language in the closed picker", () => {
  const show = (value: string) =>
    renderToStaticMarkup(
      <CaptureLanguageField value={value} onChange={() => {}} disabled={false} />
    );
  expect(show("auto")).toContain("Automatic");
  expect(show("fr")).toContain("Français");
  expect(show("fr")).not.toContain("Automatic");
  expect(show("fil")).toContain("fil");
});

it("lists the card in Settings and translates its text", () => {
  expect(SETTINGS_SECTIONS.map((section) => section.title)).toContain("Memory language");
  expect(translateSettings("Memory language", "zh")).not.toBe("Memory language");
  expect(translateSettings("Memory language", "ar")).not.toBe("Memory language");
});
