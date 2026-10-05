import { expect, it } from "bun:test";
import { translateSettings } from "../src/lib/i18n/settings.ts";

const messages = [
  "Review directory maps",
  "Proposed maps",
  "Unmapped rows",
  "Sessions",
  "Confirm",
  "Cancel",
  "Saving…",
  "Refresh list",
  "Saved maps",
  "No maps to save.",
  "Settings refreshed. No maps were saved.",
  "Settings could not be refreshed. Try Refresh list again.",
  "Review these maps, then press Confirm to save. Saved maps apply to every host on the next import or backfill run.",
  "Review suggested directory maps in a dialog. Nothing is saved until you press Confirm. Save maps remains available for manual selections.",
  "Maps could not be saved. Review the targets and confirm again.",
  "Settings changed elsewhere. Review these maps and confirm again.",
  "Settings changed elsewhere and could not be refreshed. Refresh the list before confirming again.",
  "Maps were saved, but the list could not be refreshed. Refresh the list without saving again.",
  "Saved. Maps apply to the next import or backfill run.",
  "Choose targets for rows without suggestions.",
  "No directory recorded",
  "These sessions cannot be mapped.",
  "No target chosen",
  "Target directory",
];
for (const language of ["en", "zh", "ar"] as const) {
  it(`translates all directory review text into ${language}`, () => {
    for (const message of messages) {
      const translated = translateSettings(message, language);
      expect(translated.length).toBeGreaterThan(0);
      if (language !== "en") {
        expect(translated).not.toBe(message);
        expect(translated).toMatch(language === "zh" ? /[\u4e00-\u9fff]/ : /[\u0600-\u06ff]/);
      }
    }
  });
}
