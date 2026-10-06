import { expect, it } from "bun:test";
import { translateSettings } from "../src/lib/i18n/settings.ts";

const messages = [
  "Review directory maps",
  "Proposed maps",
  "Sessions",
  "Confirm",
  "Cancel",
  "Saving…",
  "Refresh list",
  "Saved maps",
  "Settings refreshed. No maps were saved.",
  "Settings could not be refreshed. Try Refresh list again.",
  "Maps could not be saved. Review the targets and confirm again.",
  "Settings changed elsewhere. Review these maps and confirm again.",
  "Settings changed elsewhere and could not be refreshed. Refresh the list before confirming again.",
  "Maps were saved, but the list could not be refreshed. Refresh the list without saving again.",
  "Saved. Maps apply to the next import or backfill run.",
  "No directory recorded",
  "These sessions cannot be mapped.",
  "No target chosen",
  "Target directory",
  "Suggested to ignore",
  "No target",
  "Ignore",
  "Restore",
  "Ignored directories",
  "Save removals",
  "Exact",
  "Name match",
  "Guess",
  "Temporary folder",
  "App data folder",
  "Skills folder",
  "Nothing to save. Type a target in a row, or press Ignore for folders that are not projects.",
  "Tick the maps and ignores to keep, then press Confirm to save them. Saved maps apply to every host on the next import or backfill run.",
  "Smart resolve shows each proposed map and ignore in a dialog. Tick the ones to keep, then press Confirm. Nothing is saved before that.",
  "Keep a map after its sessions import. Every import checks the map before it skips a session, so removing a map makes its sessions unresolved again on the next run.",
  "Ignored. The directory stays unimported.",
  "The directory could not be ignored. Try again.",
  "Restored. The directory shows again in each host list that reported it.",
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
