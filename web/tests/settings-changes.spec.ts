import { expect, it } from "bun:test";
import {
  settingsChanges,
  type SettingsChangeField,
  type SettingsChangeWords,
} from "../src/lib/settings-changes.ts";

const words: SettingsChangeWords = {
  on: "On",
  off: "Off",
  notSet: "Not set",
  default: (value) => `Default (${value})`,
};
const limits: readonly SettingsChangeField[] = [
  { key: "maxMemories", label: "Maximum memories", default: 10 },
  { key: "similarityThreshold", label: "Similarity threshold", default: 0.6 },
];
const list = (
  saved: Record<string, unknown>,
  edits: Record<string, unknown>,
  fields: readonly SettingsChangeField[] = limits
) => settingsChanges(saved, edits, fields, words);

it("lists nothing when the save changes nothing", () => {
  // The same value as saved, next to a field the save does not touch.
  expect(list({ maxMemories: 20, similarityThreshold: 0.6 }, { maxMemories: 20 })).toEqual([]);
  // An empty request.
  expect(list({ maxMemories: 20 }, {})).toEqual([]);
  // The same value in another type, and a key the request drops (`undefined`).
  expect(list({ maxMemories: "20" }, { maxMemories: 20 })).toEqual([]);
  expect(list({ maxMemories: 20 }, { maxMemories: undefined })).toEqual([]);
});

it("lists one change with its saved value and its new value", () => {
  expect(list({ maxMemories: 10 }, { maxMemories: 20 })).toEqual([
    { key: "maxMemories", label: "Maximum memories", from: "10", to: "20" },
  ]);
});

it("lists two changes in the order of the fields, not of the request", () => {
  const rows = list(
    { maxMemories: 10, similarityThreshold: 0.6 },
    { similarityThreshold: 0.5, maxMemories: 20 }
  );
  expect(rows.map((row) => row.key)).toEqual(["maxMemories", "similarityThreshold"]);
});

it("reads a switch as On and Off, in both directions", () => {
  const fields = [{ key: "autoCapture", label: "Automatic capture" }];
  expect(list({ autoCapture: true }, { autoCapture: false }, fields)[0]).toMatchObject({
    from: "On",
    to: "Off",
  });
  expect(list({ autoCapture: false }, { autoCapture: true }, fields)[0]).toMatchObject({
    from: "Off",
    to: "On",
  });
});

it("shows a reset to default as the default value", () => {
  expect(list({ maxMemories: 20 }, { maxMemories: null })).toEqual([
    { key: "maxMemories", label: "Maximum memories", from: "20", to: "Default (10)" },
  ]);
});

it("reads a nested key as the request spells it", () => {
  const fields = [{ key: "compaction.enabled", label: "Restore compaction", default: true }];
  expect(list({ "compaction.enabled": true }, { "compaction.enabled": false }, fields)).toEqual([
    { key: "compaction.enabled", label: "Restore compaction", from: "On", to: "Off" },
  ]);
  expect(list({ "compaction.enabled": false }, { "compaction.enabled": null }, fields)[0]?.to).toBe(
    "Default (On)"
  );
});

it("uses the field's own words for a value", () => {
  const names: Record<string, string> = { en: "English", cy: "Cymraeg" };
  const fields = [
    {
      key: "summaryLanguage",
      label: "Summary language",
      print: (value: unknown) => names[String(value)],
    },
  ];
  expect(list({ summaryLanguage: "en" }, { summaryLanguage: "cy" }, fields)[0]).toMatchObject({
    from: "English",
    to: "Cymraeg",
  });
});

it("reads a value that was never saved as Not set", () => {
  expect(list({}, { maxMemories: 20 })[0]?.from).toBe("Not set");
});

it("refuses a request key that no field describes, so the dialog never omits a change", () => {
  expect(() => list({ maxMemories: 10 }, { maxMemories: 20, other: 1 })).toThrow(
    'settingsChanges: no field describes "other"'
  );
});
