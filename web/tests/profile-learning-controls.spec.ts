import { expect, it } from "bun:test";
import { translateCatalogue } from "../src/lib/i18n/settings-catalogue.ts";
import { translateSettings } from "../src/lib/i18n/settings.ts";
import {
  PROFILE_LEARNING_CONTROLS,
  PROFILE_LEARNING_FIXED_ROWS,
  PROFILE_LEARNING_KEYS,
  PROFILE_LEARNING_MESSAGES,
  hasSavedLearningKey,
  learningDefaults,
  learningFromSettings,
  learningResetEdits,
  learningSaveEdits,
} from "../src/lib/profile-learning-controls.ts";

const control = (key: string) => PROFILE_LEARNING_CONTROLS.find((entry) => entry.key === key)!;
const labels = (key: string) => control(key).options.map((option) => option.label);
const values = (key: string) => control(key).options.map((option) => option.value);

it("has the six learning keys in the order of the table", () => {
  expect(PROFILE_LEARNING_KEYS).toEqual([
    "userProfileWithoutEmail",
    "userProfileDecayBeforeMerge",
    "userProfilePromptDetail",
    "userProfileValidationEnabled",
    "showUserProfileToasts",
    "userProfileDuringCatchUp",
  ]);
  expect(PROFILE_LEARNING_CONTROLS.map((entry) => entry.key)).toEqual([...PROFILE_LEARNING_KEYS]);
});

it("offers exactly the options of the spec, with the default first", () => {
  expect(labels("userProfileWithoutEmail")).toEqual(["Learn anyway", "Skip"]);
  expect(values("userProfileWithoutEmail")).toEqual(["learn", "skip"]);
  expect(labels("userProfileDecayBeforeMerge")).toEqual(["Off", "On"]);
  expect(values("userProfileDecayBeforeMerge")).toEqual([false, true]);
  expect(labels("userProfilePromptDetail")).toEqual([
    "Prompts with profile and guidance",
    "Prompts only",
  ]);
  expect(values("userProfilePromptDetail")).toEqual(["full", "prompts-only"]);
  expect(labels("userProfileValidationEnabled")).toEqual(["Off", "On"]);
  expect(values("userProfileValidationEnabled")).toEqual([false, true]);
  expect(labels("showUserProfileToasts")).toEqual(["On", "Off"]);
  expect(values("showUserProfileToasts")).toEqual([true, false]);
  expect(labels("userProfileDuringCatchUp")).toEqual(["Keep learning", "Pause"]);
  expect(values("userProfileDuringCatchUp")).toEqual(["learn", "pause"]);
});

it("gives each control its own element id", () => {
  const ids = PROFILE_LEARNING_CONTROLS.map((entry) => entry.controlId);
  expect(new Set(ids).size).toBe(6);
  for (const id of ids) expect(id).toMatch(/^profile-learning-[a-z-]+$/);
});

it("defaults to the first option of every list", () => {
  expect(learningDefaults()).toEqual({
    userProfileWithoutEmail: "learn",
    userProfileDecayBeforeMerge: false,
    userProfilePromptDetail: "full",
    userProfileValidationEnabled: false,
    showUserProfileToasts: true,
    userProfileDuringCatchUp: "learn",
  });
});

it("shows the four fixed rows with their fixed values as text", () => {
  expect(PROFILE_LEARNING_FIXED_ROWS.map((row) => row.name)).toEqual([
    "History entry",
    "When the host model fails",
    "Reply check",
    "Save clash",
  ]);
  expect(PROFILE_LEARNING_FIXED_ROWS.map((row) => row.value)).toEqual([
    "<Host> analysis of N prompts",
    "Use the external API and show a notice",
    "On",
    "3 tries, then wait 10 minutes",
  ]);
  for (const row of PROFILE_LEARNING_FIXED_ROWS) {
    expect(row.description.length).toBeGreaterThan(0);
    expect(row.name.toLowerCase()).not.toContain("userprofile");
  }
});

it("reads saved values from the global value and falls back to the default for anything else", () => {
  const settings = {
    userProfileWithoutEmail: { globalValue: "skip" },
    userProfileDecayBeforeMerge: { globalValue: true },
    userProfilePromptDetail: { globalValue: "prompts-only" },
    userProfileValidationEnabled: { globalValue: "yes" },
    showUserProfileToasts: { globalValue: false },
    userProfileDuringCatchUp: { globalValue: "stop" },
  };
  expect(learningFromSettings(settings)).toEqual({
    userProfileWithoutEmail: "skip",
    userProfileDecayBeforeMerge: true,
    userProfilePromptDetail: "prompts-only",
    userProfileValidationEnabled: false,
    showUserProfileToasts: false,
    userProfileDuringCatchUp: "learn",
  });
  expect(learningFromSettings({})).toEqual(learningDefaults());
  expect(learningFromSettings(undefined)).toEqual(learningDefaults());
});

it("saves only the keys that changed, with their real values", () => {
  const saved = learningDefaults();
  expect(learningSaveEdits({}, saved)).toEqual({});
  expect(learningSaveEdits({ userProfileDecayBeforeMerge: false }, saved)).toEqual({});
  expect(
    learningSaveEdits(
      {
        userProfileDecayBeforeMerge: true,
        userProfileWithoutEmail: "skip",
        showUserProfileToasts: true,
      },
      saved
    )
  ).toEqual({ userProfileDecayBeforeMerge: true, userProfileWithoutEmail: "skip" });
});

it("resets all six keys with null so the file drops them", () => {
  expect(learningResetEdits()).toEqual({
    userProfileWithoutEmail: null,
    userProfileDecayBeforeMerge: null,
    userProfilePromptDetail: null,
    userProfileValidationEnabled: null,
    showUserProfileToasts: null,
    userProfileDuringCatchUp: null,
  });
});

it("turns Reset on only when one of the six keys is in the global file", () => {
  expect(hasSavedLearningKey(undefined)).toBe(false);
  expect(hasSavedLearningKey({})).toBe(false);
  expect(
    hasSavedLearningKey({
      userProfileWithoutEmail: { source: "default", hasGlobal: false },
      maxMemories: { source: "global", hasGlobal: true },
    })
  ).toBe(false);
  expect(hasSavedLearningKey({ showUserProfileToasts: { source: "global" } })).toBe(true);
  expect(hasSavedLearningKey({ userProfileDecayBeforeMerge: { hasGlobal: true } })).toBe(true);
});

it("has a Chinese and an Arabic text for every option, row text and message", () => {
  const catalogue = PROFILE_LEARNING_CONTROLS.flatMap((entry) =>
    entry.options.map((option) => option.label)
  );
  for (const text of catalogue) {
    if (text === "On" || text === "Off") continue;
    expect(translateCatalogue(text, "zh")).not.toBe(text);
    expect(translateCatalogue(text, "ar")).not.toBe(text);
  }
  const rows = PROFILE_LEARNING_FIXED_ROWS.flatMap((row) => [row.name, row.description, row.value]);
  for (const message of [...rows, ...PROFILE_LEARNING_MESSAGES]) {
    if (message === "On") continue;
    expect({ message, zh: translateSettings(message, "zh") !== message }).toEqual({
      message,
      zh: true,
    });
    expect({ message, ar: translateSettings(message, "ar") !== message }).toEqual({
      message,
      ar: true,
    });
  }
});
